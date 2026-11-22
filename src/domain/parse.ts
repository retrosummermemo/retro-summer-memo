import {
  createSeedDocument,
  PROFILE_SECTIONS,
  defaultEnabledSections,
  defaultSections,
  type BulletNode,
  type CatalogSection,
  type Cv,
  type CvVersion,
  type EducationEntry,
  type EducationNode,
  type ExperienceSectionNode,
  type Job,
  type JobRole,
  type PersonNode,
  profileFromLegacy,
  type Profile,
  type ProfileField,
  type ProfileFieldKind,
  type SkillsNode,
  type KnowledgeAnswer,
  type KnowledgeLevel,
  type ResumeDocument,
  type ResumeEdge,
  type ResumeNode,
  type RoleGraph,
  type RoleNode,
  type SectionEntry,
  type SectionNode,
  type SkillGroup,
  type Snapshot,
  type SnapshotBlock,
  type TextEntry,
} from './model'
import { defaultFont, defaultFontSize, defaultMargin, isAccentColor, isFontId, isFontSize, isLineSpacing, isMarginId, isPageSize } from './fonts'
import { readExperiences, type Experience } from './experiences'
import { readExtra, withExtra } from './extra'
import { readApplications, readApplicationStatuses, withReferencedStatuses } from './applications'
import { readCompanies } from './companies'
import { isTemplateId } from './templates'

/**
 * Turns any stored document (current or older formats) into a valid ResumeDocument.
 * Invalid pieces are dropped rather than failing the whole load.
 */
export function parseDocument(value: unknown): ResumeDocument {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return createSeedDocument()
  }

  const parsed = value.nodes.map(parseNode).filter((node): node is ResumeNode => node !== null)
  const nodes = withoutSectionMarkers(withPersonalData(keepSinglePerson(parsed), value.profile))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges: ResumeEdge[] = []
  const seenEdges = new Set<string>()

  for (const entry of value.edges) {
    const edge = parseEdge(entry, nodeById)
    if (!edge || seenEdges.has(edge.id)) continue
    seenEdges.add(edge.id)
    edges.push(edge)
  }

  const { cvs, activeCvId } = resolveCvs(value, nodes, edges)
  const bank = readBank(value.bank)
  const pipeline = readApplicationStatuses(value.applicationStatuses)
  const applications = readApplications(value.applications, pipeline)
  return {
    nodes,
    edges,
    cvs,
    activeCvId,
    profile: readProfile(value.profile, nodes),
    sections: readSections(value.sections),
    roleGraphs: readRoleGraphs(value.roleGraphs),
    bank,
    knowledge: readKnowledge(value.knowledge, bank),
    applications,
    applicationStatuses: withReferencedStatuses(pipeline, applications),
    companies: readCompanies(value.companies),
  }
}

/** A CV graph (`{ nodes, edges }`) with invalid nodes and dangling edges removed. */
export function parseGraph(value: unknown): { nodes: ResumeNode[]; edges: ResumeEdge[] } {
  return (isRecord(value) ? readStoredGraph(value) : undefined) ?? { nodes: [], edges: [] }
}

/** A role template graph: one role node plus its experience nodes. */
export function parseRoleGraph(id: string, value: unknown): RoleGraph | null {
  return isRecord(value) ? parseRoleGraphRecord({ ...value, id })[0] ?? null : null
}

function readProfile(value: unknown, nodes: ResumeNode[]): Profile {
  if (isRecord(value)) return parseProfile(value)
  const person = nodes.find((node) => node.type === 'person')
  return person ? parseProfile(person.data) : profileFromLegacy('', '', '', '')
}

function resolveCvs(value: Record<string, unknown>, nodes: ResumeNode[], edges: ResumeEdge[]): { cvs: Cv[]; activeCvId: string } {
  // Documents without a `cvs` field predate multiple CVs; an empty array means the user deleted them all.
  const drafts = Array.isArray(value.cvs) ? value.cvs.flatMap(parseCv) : [legacyCv(value)]
  const requested = typeof value.activeCvId === 'string' ? value.activeCvId : ''
  const activeCvId = drafts.some((cv) => cv.cv.id === requested) ? requested : drafts[0]?.cv.id ?? ''
  const cvs = drafts.map(({ cv, graph }) => {
    if (cv.id === activeCvId) return { ...cv, nodes, edges }
    if (graph) return { ...cv, nodes: graph.nodes, edges: graph.edges }
    return { ...cv, nodes: cloneGraph(nodes), edges: edges.map((edge) => ({ ...edge })) }
  })
  return { cvs, activeCvId }
}

function cloneGraph(nodes: ResumeNode[]): ResumeNode[] {
  return structuredClone(nodes).map((node) => ({ ...node, selected: false }))
}

export function readStyle(
  value: Record<string, unknown>,
): Pick<Cv, 'fontId' | 'fontSize' | 'lineHeight' | 'marginId' | 'pageSize' | 'skillsFormat' | 'accentColor' | 'sectionOrder'> {
  const templateId = isTemplateId(value.templateId) ? value.templateId : 'classic'
  return {
    fontId: isFontId(value.fontId) ? value.fontId : defaultFont(templateId),
    fontSize: isFontSize(value.fontSize) ? value.fontSize : defaultFontSize(templateId),
    lineHeight: isLineSpacing(value.lineHeight) ? value.lineHeight : 1.15,
    marginId: isMarginId(value.marginId) ? value.marginId : defaultMargin(templateId),
    pageSize: isPageSize(value.pageSize) ? value.pageSize : 'letter',
    ...(value.skillsFormat === 'list' || value.skillsFormat === 'comma' ? { skillsFormat: value.skillsFormat } : {}),
    ...(isAccentColor(value.accentColor) ? { accentColor: value.accentColor.toLowerCase() } : {}),
    ...(Array.isArray(value.sectionOrder) ? { sectionOrder: [...new Set(value.sectionOrder.filter((id): id is string => typeof id === 'string' && id !== ''))] } : {}),
  }
}

/** Which application a CV was made for and which CV it was copied from, when stored. */
export function readOwner(value: Record<string, unknown>): Pick<Cv, 'applicationId' | 'basedOn'> {
  return {
    ...(typeof value.applicationId === 'string' && value.applicationId ? { applicationId: value.applicationId } : {}),
    ...(typeof value.basedOn === 'string' && value.basedOn ? { basedOn: value.basedOn } : {}),
  }
}

type DraftCv = {
  cv: Omit<Cv, 'nodes' | 'edges'>
  graph?: { nodes: ResumeNode[]; edges: ResumeEdge[] }
}

function legacyCv(value: Record<string, unknown>): DraftCv {
  const snapshot = parseSnapshot(value.snapshot)
  return {
    cv: {
      id: 'cv',
      title: 'CV',
      position: '',
      company: '',
      posting: '',
      summary: '',
      templateId: isTemplateId(value.templateId) ? value.templateId : 'classic',
      ...readStyle(value),
      enabledSections: readEnabled(value.enabledSections),
      versions: snapshot ? [{ id: 'legacy-version', createdAt: '', snapshot }] : [],
    },
  }
}

const cvKeys = [
  'id', 'title', 'position', 'company', 'posting', 'summary', 'templateId', 'fontId', 'fontSize', 'lineHeight',
  'marginId', 'pageSize', 'skillsFormat', 'accentColor', 'sectionOrder', 'enabledSections', 'versions', 'nodes', 'edges', 'graph',
  'applicationId', 'basedOn',
]

function parseCv(value: unknown): DraftCv[] {
  if (!isRecord(value) || typeof value.id !== 'string') return []
  const versions = Array.isArray(value.versions) ? value.versions.flatMap(parseVersion) : []
  return [{
    cv: withExtra({
      id: value.id,
      title: readString(value.title).trim() || 'Sin título',
      position: readString(value.position),
      company: readString(value.company),
      posting: readString(value.posting),
      summary: readString(value.summary),
      templateId: isTemplateId(value.templateId) ? value.templateId : 'classic',
      ...readStyle(value),
      enabledSections: readEnabled(value.enabledSections),
      versions,
      ...readOwner(value),
    }, readExtra(value, cvKeys)),
    graph: readStoredGraph(value),
  }]
}

function readStoredGraph(value: Record<string, unknown>): { nodes: ResumeNode[]; edges: ResumeEdge[] } | undefined {
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return undefined
  const nodes = withoutSectionMarkers(value.nodes.map(parseNode).filter((node): node is ResumeNode => node !== null))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges: ResumeEdge[] = []
  const seen = new Set<string>()
  for (const entry of value.edges) {
    const edge = parseEdge(entry, nodeById)
    if (!edge || seen.has(edge.id)) continue
    seen.add(edge.id)
    edges.push(edge)
  }
  return { nodes, edges }
}

function parseVersion(value: unknown): CvVersion[] {
  if (!isRecord(value) || typeof value.id !== 'string') return []
  const snapshot = parseSnapshot(value.snapshot)
  if (!snapshot) return []
  return [{ id: value.id, createdAt: readString(value.createdAt), snapshot }]
}

function keepSinglePerson(nodes: ResumeNode[]): ResumeNode[] {
  let seen = false
  return nodes.filter((node) => {
    if (node.type !== 'person') return true
    if (seen) return false
    seen = true
    return true
  })
}

/**
 * Drops the heading markers older versions placed on the canvas (experience, skills, and section
 * nodes for profile sections). Section nodes of other sections are content: they say which entries
 * of projects, certifications… the CV shows, so they stay.
 */
function withoutSectionMarkers(nodes: ResumeNode[]): ResumeNode[] {
  return keepSingle(
    nodes.filter(
      (node) =>
        node.type !== 'experience' &&
        node.type !== 'skills' &&
        !(node.type === 'section' && PROFILE_SECTIONS.includes(node.data.sectionId)),
    ),
    'education',
  )
}

function keepSingle(nodes: ResumeNode[], type: ResumeNode['type']) {
  let seen = false
  return nodes.filter((node) => {
    if (node.type !== type) return true
    if (seen) return false
    seen = true
    return true
  })
}

function withPersonalData(nodes: ResumeNode[], storedProfile: unknown): ResumeNode[] {
  if (nodes.some((node) => node.type === 'person') || !isRecord(storedProfile)) return nodes
  const person: PersonNode = {
    id: 'person',
    type: 'person',
    position: { x: 48, y: 48 },
    data: parseProfile(storedProfile),
  }
  return [person, ...nodes]
}

export function parseProfile(value: unknown): Profile {
  const record = isRecord(value) ? value : {}
  const name = readString(record.name)
  const fields = Array.isArray(record.fields)
    ? record.fields.flatMap(parseField)
    : profileFromLegacy(name, readString(record.email), readString(record.phone), readString(record.location)).fields
  const profile: Profile = withExtra({
    name,
    fields,
    education: readEducation(record.education),
    jobs: readJobs(record.jobs),
  }, readExtra(record, ['name', 'fields', 'education', 'jobs', 'hidden', 'email', 'phone', 'location']))
  return record.hidden === true ? { ...profile, hidden: true } : profile
}

function readJobs(value: unknown): Job[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') return []
    const roles = Array.isArray(entry.roles) ? entry.roles.flatMap(parseJobRole) : []
    return [withExtra({
      id: entry.id,
      company: readString(entry.company),
      roles: roles.length > 0 ? roles : [{ id: crypto.randomUUID(), title: '', location: '', start: '', end: '' }],
    }, readExtra(entry, ['id', 'company', 'roles']))]
  })
}

function parseJobRole(value: unknown): JobRole[] {
  if (!isRecord(value) || typeof value.id !== 'string') return []
  return [withExtra({
    id: value.id,
    title: readString(value.title),
    location: readString(value.location),
    start: readString(value.start),
    end: readString(value.end),
  }, readExtra(value, ['id', 'title', 'location', 'start', 'end']))]
}

function parseField(value: unknown): ProfileField[] {
  if (!isRecord(value) || typeof value.id !== 'string') return []
  return [withExtra({
    id: value.id,
    label: readString(value.label),
    value: readString(value.value),
    kind: readFieldKind(value.kind),
  }, readExtra(value, ['id', 'label', 'value', 'kind']))]
}

function readFieldKind(value: unknown): ProfileFieldKind {
  if (value === 'email' || value === 'phone' || value === 'text' || value === 'link') return value
  return 'link'
}

function parseNode(value: unknown): ResumeNode | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.position)) return null
  const x = numberOrNull(value.position.x)
  const y = numberOrNull(value.position.y)
  if (x === null || y === null) return null
  const data = isRecord(value.data) ? value.data : {}
  const position = { x, y }

  if (value.type === 'person') {
    const node: PersonNode = {
      id: value.id,
      type: 'person',
      position,
      data: parseProfile(data),
    }
    return node
  }

  if (value.type === 'role') {
    const node: RoleNode = {
      id: value.id,
      type: 'role',
      position,
      data: {
        title: readString(data.title),
        company: readString(data.company),
        location: readString(data.location),
        start: readString(data.start),
        end: readString(data.end),
        ...(data.pending === true ? { pending: true } : {}),
      },
    }
    return node
  }

  if (value.type === 'bullet') {
    const node: BulletNode = {
      id: value.id,
      type: 'bullet',
      position,
      data: {
        text: readString(data.text),
        ability: readString(data.ability),
        skills: readStringList(data.skills),
        ...(data.hidden === true ? { hidden: true } : {}),
      },
    }
    return node
  }

  if (value.type === 'skills') {
    const node: SkillsNode = {
      id: value.id,
      type: 'skills',
      position,
      data: {
        skills: readStringList(data.skills),
        ...(data.hidden === true ? { hidden: true } : {}),
      },
    }
    return node
  }

  if (value.type === 'experience') {
    const node: ExperienceSectionNode = {
      id: value.id,
      type: 'experience',
      position,
      data: {},
    }
    return node
  }

  if (value.type === 'education') {
    const node: EducationNode = {
      id: value.id,
      type: 'education',
      position,
      data: { entries: readEducation(data.entries) },
    }
    return node
  }

  if (value.type === 'section') {
    const sectionId = readString(data.sectionId)
    if (!sectionId) return null
    const node: SectionNode = {
      id: value.id,
      type: 'section',
      position,
      data: {
        sectionId,
        ...(Array.isArray(data.entryIds) ? { entryIds: readStringList(data.entryIds) } : {}),
        ...(Array.isArray(data.experienceIds) ? { experienceIds: readStringList(data.experienceIds) } : {}),
      },
    }
    return node
  }

  return null
}

function readBank(value: unknown): Experience[] {
  return readExperiences(value)
}

function readKnowledge(value: unknown, bank: Experience[]): KnowledgeAnswer[] {
  if (!Array.isArray(value)) return []
  const known = new Set(bank.map((item) => item.id))
  const seen = new Set<string>()
  const answers: KnowledgeAnswer[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || seen.has(entry.id)) continue
    if (!known.has(entry.id)) continue
    if (entry.level !== 0 && entry.level !== 1 && entry.level !== 2) continue
    seen.add(entry.id)
    answers.push({ id: entry.id, level: entry.level as KnowledgeLevel })
  }
  return answers
}

function readRoleGraphs(value: unknown): RoleGraph[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(parseRoleGraphRecord)
}

function parseRoleGraphRecord(value: unknown): RoleGraph[] {
  if (!isRecord(value) || typeof value.id !== 'string') return []
  const parsed = Array.isArray(value.nodes) ? value.nodes.map(parseNode).filter((node): node is ResumeNode => node !== null) : []
  const role = parsed.find((node) => node.type === 'role')
  if (!role) return []
  const nodes = [role, ...parsed.filter((node) => node.type === 'bullet')]
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges: ResumeEdge[] = []
  if (Array.isArray(value.edges)) {
    for (const entry of value.edges) {
      const edge = parseEdge(entry, nodeById)
      if (!edge || edges.some((item) => item.id === edge.id)) continue
      edges.push(edge)
    }
  }
  return [{ id: value.id, nodes, edges }]
}

function parseEdge(value: unknown, nodeById: Map<string, ResumeNode>): ResumeEdge | null {
  if (!isRecord(value) || typeof value.source !== 'string' || typeof value.target !== 'string') return null
  const source = nodeById.get(value.source)
  const target = nodeById.get(value.target)
  if (source?.type !== 'role' || target?.type !== 'bullet') return null
  const id = typeof value.id === 'string' ? value.id : `e-${value.source}-${value.target}`
  return { id, source: value.source, target: value.target }
}

export function parseSnapshot(value: unknown): Snapshot | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || !Array.isArray(value.roles) || !Array.isArray(value.skillGroups)) return null

  const roles = value.roles.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') return []
    const bullets = Array.isArray(entry.bullets)
      ? entry.bullets.flatMap((bullet) => {
          if (!isRecord(bullet) || typeof bullet.id !== 'string') return []
          return [
            {
              id: bullet.id,
              text: readString(bullet.text),
              ability: readString(bullet.ability),
              skills: readStringList(bullet.skills),
            },
          ]
        })
      : []
    return [
      {
        id: entry.id,
        title: readString(entry.title),
        company: readString(entry.company),
        location: readString(entry.location),
        start: readString(entry.start),
        end: readString(entry.end),
        bullets,
      },
    ]
  })

  const skillGroups: SkillGroup[] = value.skillGroups.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const ability = readString(entry.ability)
    if (!ability) return []
    return [{ ability, skills: readStringList(entry.skills) }]
  })

  return {
    roles,
    skillGroups,
    profile: parseProfile(value.profile),
    summary: readString(value.summary),
    skills: value.skills === null || value.skills === undefined ? null : readStringList(value.skills),
    education: Array.isArray(value.education) ? readEducation(value.education) : null,
    blocks: Array.isArray(value.blocks) ? readBlocks(value.blocks) : null,
    ...(value.placeholder === true ? { placeholder: true } : {}),
  }
}

export function readEnabled(value: unknown) {
  if (!Array.isArray(value)) return defaultEnabledSections()
  return value.filter((item): item is string => typeof item === 'string')
}

export function readSections(value: unknown): CatalogSection[] {
  const parsed = Array.isArray(value) ? value.flatMap(parseSection) : []
  const byId = new Map(parsed.map((section) => [section.id, section]))
  const builtins = defaultSections().map((section) => byId.get(section.id) ?? section)
  const custom = parsed.filter((section) => !section.builtIn && !builtins.some((item) => item.id === section.id))
  return [...builtins, ...custom]
}

function parseSection(value: unknown): CatalogSection[] {
  if (!isRecord(value) || typeof value.id !== 'string') return []
  const builtin = defaultSections().find((section) => section.id === value.id)
  const entries = Array.isArray(value.entries) ? value.entries.flatMap(parseSectionEntry) : []
  return [withExtra({
    id: value.id,
    name: readString(value.name).trim() || builtin?.name || 'Section',
    description: readString(value.description),
    active: value.active === true || value.active === false ? value.active : value.id !== 'projects',
    builtIn: Boolean(builtin),
    ...(entries.length > 0 ? { entries } : {}),
  }, readExtra(value, ['id', 'name', 'description', 'active', 'builtIn', 'entries']))]
}

function parseTextEntry(value: unknown): TextEntry[] {
  if (!isRecord(value) || typeof value.id !== 'string') return []
  const entry: TextEntry = { id: value.id, text: readString(value.text) }
  for (const key of ['title', 'subtitle', 'location', 'dates', 'description'] as const) {
    const text = readString(value[key])
    if (text) entry[key] = text
  }
  const bullets = readStringList(value.bullets)
  if (bullets.length > 0) entry.bullets = bullets
  return [entry]
}

function parseSectionEntry(value: unknown): SectionEntry[] {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return []
  return [withExtra({
    id: value.id,
    title: readString(value.title),
    subtitle: readString(value.subtitle),
    location: readString(value.location),
    start: readString(value.start),
    end: readString(value.end),
    description: readString(value.description),
    url: readString(value.url),
  }, readExtra(value, ['id', 'title', 'subtitle', 'location', 'start', 'end', 'description', 'url']))]
}

function readBlocks(value: unknown[]): SnapshotBlock[] {
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') return []
    const entries = Array.isArray(entry.entries) ? entry.entries.flatMap(parseTextEntry).filter((item) => item.text.trim()) : []
    if (entries.length === 0) return []
    return [{ id: entry.id, name: readString(entry.name) || 'Section', entries }]
  })
}

function readEducation(value: unknown): EducationEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') return []
    return [withExtra({
      id: entry.id,
      school: readString(entry.school),
      degree: readString(entry.degree),
      start: readString(entry.start),
      end: readString(entry.end),
    }, readExtra(entry, ['id', 'school', 'degree', 'start', 'end']))]
  })
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readStringList(value: unknown): string[] {
  const entries = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : []
  return entries
    .filter((entry): entry is string => typeof entry === 'string')
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
