import { defaultApplicationStatuses, type Application, type ApplicationStatus } from './applications'
import type { Company } from './companies'
import type { Extra } from './extra'
import { experienceCatalog } from './catalog'
import { cloneSeedBank, type Experience } from './experiences'
import type { FontId, FontSize, LineSpacing, MarginId, PageSize } from './fonts'
import type { TemplateId } from './templates'

export type ProfileFieldKind = 'email' | 'phone' | 'text' | 'link'

export type ProfileField = {
  id: string
  label: string
  value: string
  kind: ProfileFieldKind
  extra?: Extra
}

/** A title held at a company — multiple roles under one job = promotions. */
export type JobRole = {
  id: string
  title: string
  location: string
  start: string
  end: string
  extra?: Extra
}

export type Job = {
  id: string
  company: string
  roles: JobRole[]
  extra?: Extra
}

export type EducationEntry = {
  id: string
  school: string
  degree: string
  start: string
  end: string
  extra?: Extra
}

export type EducationData = {
  entries: EducationEntry[]
}

export type Profile = {
  name: string
  fields: ProfileField[]
  education: EducationEntry[]
  jobs: Job[]
  hidden?: boolean
  extra?: Extra
}

export type RoleData = {
  title: string
  company: string
  location: string
  start: string
  end: string
  /** Empty role node waiting for an existing Personal role via select. */
  pending?: boolean
}

export type BulletData = {
  text: string
  ability: string
  skills: string[]
  hidden?: boolean
}

export type SkillsData = {
  skills: string[]
  hidden?: boolean
}

export type ExperienceSectionData = Record<string, never>

/**
 * A node of a CV graph. Structurally compatible with React Flow's `Node`, but owned by the
 * domain so the engine runs without the canvas library (server, MCP, tests).
 */
export type GraphNode<TData, TType extends string> = {
  id: string
  type: TType
  position: { x: number; y: number }
  data: TData
  /** UI state; never persisted. */
  selected?: boolean
}

export type GraphEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export type PersonNode = GraphNode<Profile, 'person'>
export type RoleNode = GraphNode<RoleData, 'role'>
export type BulletNode = GraphNode<BulletData, 'bullet'>
export type SkillsNode = GraphNode<SkillsData, 'skills'>
export type ExperienceSectionNode = GraphNode<ExperienceSectionData, 'experience'>
export type EducationNode = GraphNode<EducationData, 'education'>
export type SectionData = {
  sectionId: string
  /** Entries of the section to show (all when absent). */
  entryIds?: string[]
  /** Experiences to list under those entries (all linked ones when absent). */
  experienceIds?: string[]
}
export type SectionNode = GraphNode<SectionData, 'section'>
export type ResumeNode = PersonNode | RoleNode | BulletNode | SkillsNode | ExperienceSectionNode | EducationNode | SectionNode
export type ResumeEdge = GraphEdge

export type RoleGraph = {
  id: string
  nodes: ResumeNode[]
  edges: ResumeEdge[]
}

export type BuiltBullet = {
  id: string
  text: string
  ability: string
  skills: string[]
}

export type BuiltRole = {
  id: string
  title: string
  company: string
  location: string
  start: string
  end: string
  bullets: BuiltBullet[]
}

export type SkillGroup = {
  ability: string
  skills: string[]
}

export type TextEntry = {
  id: string
  /** One-line version, for plain renderings. */
  text: string
  title?: string
  subtitle?: string
  location?: string
  dates?: string
  description?: string
  bullets?: string[]
}

/** An item of any section: a project, a certification, a language, an award… */
export type SectionEntry = {
  id: string
  title: string
  /** Organization, issuer, level… */
  subtitle: string
  location: string
  start: string
  end: string
  description: string
  url: string
  extra?: Extra
}

export type CatalogSection = {
  id: string
  name: string
  description: string
  active: boolean
  builtIn: boolean
  /** Its items. Experience and Education take theirs from the profile (roles, education). */
  entries?: SectionEntry[]
  extra?: Extra
}

export type SnapshotBlock = {
  id: string
  name: string
  entries: TextEntry[]
}

export type Snapshot = {
  profile: Profile
  summary: string
  skills: string[] | null
  roles: BuiltRole[]
  education: EducationEntry[] | null
  skillGroups: SkillGroup[]
  blocks: SnapshotBlock[] | null
  placeholder?: boolean
}

export type CvVersion = {
  id: string
  createdAt: string
  snapshot: Snapshot
}

export type Cv = {
  id: string
  title: string
  /** Target role / position for this tailored CV. */
  position: string
  /** Target company for this application. */
  company: string
  /** Job posting(s) this CV was built from. */
  posting: string
  summary: string
  templateId: TemplateId
  fontId: FontId
  fontSize: FontSize
  lineHeight: LineSpacing
  marginId: MarginId
  pageSize: PageSize
  skillsFormat?: 'list' | 'comma'
  /** Color of the name, headings and rules (hex); none means the default dark. */
  accentColor?: string
  /** Body sections in display order (ids); missing ones follow in the default order. */
  sectionOrder?: string[]
  enabledSections: string[]
  versions: CvVersion[]
  nodes: ResumeNode[]
  edges: ResumeEdge[]
  /** The application this CV was made for (its tailored copy). None: a general CV, like "CV React". */
  applicationId?: string
  /** The CV it was copied from. */
  basedOn?: string
  /** Anything else: language, notes… */
  extra?: Extra
}

export type KnowledgeLevel = 0 | 1 | 2

export type KnowledgeAnswer = {
  id: string
  level: KnowledgeLevel
}

export type ResumeDocument = {
  profile: Profile
  sections: CatalogSection[]
  roleGraphs: RoleGraph[]
  /** Editable experience bank (seeded from shipped presets). */
  bank: Experience[]
  knowledge: KnowledgeAnswer[]
  /** Graph of the CV open in the workspace (`activeCvId`); other CVs keep theirs in `cvs[].nodes`. */
  nodes: ResumeNode[]
  edges: ResumeEdge[]
  cvs: Cv[]
  activeCvId: string
  applications: Application[]
  /** Pipeline steps, in order. */
  applicationStatuses: ApplicationStatus[]
  /** What the user knows about the companies they apply to (matched to applications by name). */
  companies: Company[]
}

const builtinSectionDefs: { id: string; name: string }[] = [
  { id: 'personal', name: 'Personal' },
  { id: 'experience', name: 'Work Experience' },
  { id: 'education', name: 'Education' },
  { id: 'skills', name: 'Skills' },
  { id: 'projects', name: 'Personal projects' },
]

export function defaultSections(): CatalogSection[] {
  return builtinSectionDefs.map((section) => ({
    ...section,
    description: '',
    active: section.id !== 'projects',
    builtIn: true,
  }))
}

export function defaultEnabledSections() {
  return ['personal', 'experience', 'education', 'skills']
}

/** The CV open in the workspace; undefined once every CV has been deleted. */
export function activeCv(document: ResumeDocument): Cv | undefined {
  return document.cvs.find((cv) => cv.id === document.activeCvId) ?? document.cvs[0]
}

const defaultFieldDefs: { id: string; label: string; kind: ProfileFieldKind }[] = [
  { id: 'email', label: 'Email', kind: 'email' },
  { id: 'phone', label: 'Phone', kind: 'phone' },
  { id: 'location', label: 'Location', kind: 'text' },
  { id: 'linkedin', label: 'LinkedIn', kind: 'link' },
  { id: 'github', label: 'GitHub', kind: 'link' },
  { id: 'website', label: 'Website', kind: 'link' },
]

export function defaultFields(): ProfileField[] {
  return defaultFieldDefs.map((field) => ({ ...field, value: '' }))
}

export function emptyEducationEntry(): EducationEntry {
  return { id: crypto.randomUUID(), school: '', degree: '', start: '', end: '' }
}

export function emptyJobRole(): JobRole {
  return { id: crypto.randomUUID(), title: '', location: '', start: '', end: '' }
}

export function emptyJob(): Job {
  return { id: crypto.randomUUID(), company: '', roles: [emptyJobRole()] }
}

/** Flat list of Personal jobs ready to drop onto a CV as roles (company required). */
export type PersonalRoleOption = {
  key: string
  company: string
  title: string
  location: string
  start: string
  end: string
}

export function personalRoleOptions(jobs: Job[]): PersonalRoleOption[] {
  const options: PersonalRoleOption[] = []
  for (const job of jobs) {
    const company = job.company.trim()
    if (!company) continue
    for (const role of job.roles) {
      const title = role.title.trim()
      if (!title) continue
      options.push({
        key: `${job.id}:${role.id}`,
        company,
        title,
        location: role.location,
        start: role.start,
        end: role.end,
      })
    }
  }
  return options
}

export function roleDataFromPersonal(option: PersonalRoleOption): RoleData {
  return {
    title: option.title,
    company: option.company,
    location: option.location,
    start: option.start,
    end: option.end,
  }
}

export function emptyProfile(): Profile {
  return { name: '', fields: defaultFields(), education: [], jobs: [] }
}

export function emptySnapshot(): Snapshot {
  return {
    profile: emptyProfile(),
    summary: '',
    skills: [],
    roles: [],
    education: [],
    skillGroups: [],
    blocks: [],
    placeholder: true,
  }
}

export function profileFromLegacy(name: string, email: string, phone: string, location: string): Profile {
  const values: Record<string, string> = { email, phone, location }
  return {
    name,
    fields: defaultFields().map((field) => ({ ...field, value: values[field.id] ?? '' })),
    education: [],
    jobs: [],
  }
}

export function contactParts(fields: ProfileField[]): string[] {
  return fields.map((field) => field.value.trim()).filter(Boolean)
}

const ROLE_X = 48
const BULLET_X = 400
const ORPHAN_X = 760
const TOP = 48
const ROW = 150

export function isPersonNode(node: ResumeNode): node is PersonNode {
  return node.type === 'person'
}

export function isRoleNode(node: ResumeNode): node is RoleNode {
  return node.type === 'role'
}

export function isBulletNode(node: ResumeNode): node is BulletNode {
  return node.type === 'bullet'
}

export function isSkillsNode(node: ResumeNode): node is SkillsNode {
  return node.type === 'skills'
}

export function isExperienceSectionNode(node: ResumeNode): node is ExperienceSectionNode {
  return node.type === 'experience'
}

export function isEducationNode(node: ResumeNode): node is EducationNode {
  return node.type === 'education'
}

export function isSectionNode(node: ResumeNode): node is SectionNode {
  return node.type === 'section'
}

export function roleHasExperience(
  nodes: ResumeNode[],
  edges: ResumeEdge[],
  roleId: string,
  text: string,
  exceptId?: string,
) {
  const key = text.trim().toLocaleLowerCase()
  if (!key) return false
  return edges.some((edge) => {
    if (edge.source !== roleId || edge.target === exceptId) return false
    const target = nodes.find((node) => node.id === edge.target)
    return target?.type === 'bullet' && target.data.text.trim().toLocaleLowerCase() === key
  })
}

export function cloneProfile(profile: Profile): Profile {
  return {
    name: profile.name,
    fields: profile.fields.map((field) => ({ ...field })),
    education: profile.education.map((entry) => ({ ...entry })),
    jobs: profile.jobs.map((job) => ({
      ...job,
      roles: job.roles.map((role) => ({ ...role })),
    })),
    ...(profile.hidden ? { hidden: true } : {}),
  }
}

export function applyProfile(nodes: ResumeNode[], profile: Profile): ResumeNode[] {
  return nodes.map((node) => (
    node.type === 'person'
      ? {
          ...node,
          data: cloneProfile(profile),
        }
      : node
  ))
}

export function personalGraph(profile: Profile): { nodes: ResumeNode[]; edges: ResumeEdge[] } {
  const person: PersonNode = {
    id: crypto.randomUUID(),
    type: 'person',
    position: { x: ROLE_X, y: TOP },
    data: cloneProfile(profile),
  }
  return { nodes: [person], edges: [] }
}

/**
 * What a new account starts with: no profile data, experiences, CVs nor applications (the user's
 * assistant fills them through the MCP), just the CV sections and the default pipeline.
 */
export function createEmptyDocument(): ResumeDocument {
  return {
    profile: emptyProfile(),
    sections: defaultSections(),
    roleGraphs: [],
    bank: [],
    knowledge: [],
    applications: [],
    applicationStatuses: defaultApplicationStatuses(),
    companies: [],
    activeCvId: '',
    nodes: [],
    edges: [],
    cvs: [],
  }
}

/** A document with an example CV and the shipped experience bank (tests and demos). */
export function createSeedDocument(): ResumeDocument {
  const profile = emptyProfile()
  const { nodes, edges } = personalGraph(profile)
  const sections = defaultSections()
  return {
    profile,
    sections,
    roleGraphs: [],
    bank: cloneSeedBank(),
    knowledge: [],
    applications: [],
    applicationStatuses: defaultApplicationStatuses(),
    companies: [],
    activeCvId: 'seed-cv',
    nodes,
    edges,
    cvs: [{
      id: 'seed-cv',
      title: 'CV',
      position: '',
      company: '',
      posting: '',
      summary: '',
      templateId: 'classic',
      fontId: 'times',
      fontSize: 12,
      lineHeight: 1.15,
      marginId: 'normal',
      pageSize: 'letter',
      enabledSections: ['personal'],
      versions: [{
        id: 'seed-version',
        createdAt: '',
        snapshot: emptySnapshot(),
      }],
      nodes,
      edges,
    }],
  }
}

export function nextPosition(nodes: ResumeNode[], type: ResumeNode['type']): { x: number; y: number } {
  const column = nodes.filter((node) => node.type === type)
  const x = type === 'role' ? ROLE_X : BULLET_X
  if (column.length === 0) return { x, y: TOP }
  const y = Math.max(...column.map((node) => node.position.y)) + ROW
  return { x, y }
}

export function arrangeNodes(nodes: ResumeNode[], edges: ResumeEdge[]): ResumeNode[] {
  const person = nodes.find(isPersonNode)
  const roles = nodes.filter(isRoleNode).sort(byPosition)
  const bullets = nodes.filter(isBulletNode)
  const bulletById = new Map(bullets.map((node) => [node.id, node]))
  const positions = new Map<string, { x: number; y: number }>()
  const placed = new Set<string>()

  const education = nodes.find(isEducationNode)
  if (person) positions.set(person.id, { x: ROLE_X, y: TOP })
  if (education) positions.set(education.id, { x: BULLET_X, y: TOP })
  let y = person || education ? 280 : TOP
  for (const role of roles) {
    positions.set(role.id, { x: ROLE_X, y })
    const children: BulletNode[] = []
    const seen = new Set<string>()
    for (const edge of edges) {
      if (edge.source !== role.id) continue
      const bullet = bulletById.get(edge.target)
      if (!bullet || placed.has(bullet.id) || seen.has(bullet.id)) continue
      seen.add(bullet.id)
      children.push(bullet)
    }
    children.sort(byPosition)
    children.forEach((child, index) => {
      placed.add(child.id)
      positions.set(child.id, { x: BULLET_X, y: y + index * ROW })
    })
    const block = Math.max(ROW, children.length * ROW)
    y += block + 36
  }

  let orphanY = TOP
  for (const bullet of bullets.filter((node) => !placed.has(node.id)).sort(byPosition)) {
    positions.set(bullet.id, { x: ORPHAN_X, y: orphanY })
    orphanY += ROW
  }

  return nodes.map((node) => {
    const position = positions.get(node.id)
    return position ? { ...node, position } : node
  })
}

/** Document data a CV needs besides its graph: entries of sections and the experiences linked to them. */
export type BuildContext = { sections: CatalogSection[]; bank: Experience[] }

/** Sections whose items come from the profile (or are built in), not from `section.entries`. */
export const PROFILE_SECTIONS = ['personal', 'experience', 'education', 'skills']

export function buildResume(nodes: ResumeNode[], edges: ResumeEdge[], summary: string, context?: BuildContext): Snapshot {
  const roles = nodes.filter((node): node is RoleNode => isRoleNode(node) && !node.data.pending).sort(byPosition)
  const bulletById = new Map(nodes.filter(isBulletNode).map((node) => [node.id, node]))
  const used = new Set<string>()
  const groups = new Map<string, { ability: string; skills: string[]; seen: Set<string> }>()

  const person = nodes.find(isPersonNode)
  const profile: Profile = person && !person.data.hidden
    ? {
        name: person.data.name.trim(),
        fields: person.data.fields.map((field) => ({
          ...field,
          label: field.label.trim(),
          value: field.value.trim(),
        })),
        education: person.data.education.map((entry) => ({
          ...entry,
          school: entry.school.trim(),
          degree: entry.degree.trim(),
          start: entry.start.trim(),
          end: entry.end.trim(),
        })),
        jobs: person.data.jobs.map((job) => ({
          ...job,
          company: job.company.trim(),
      roles: job.roles.map((role) => ({
            ...role,
            title: role.title.trim(),
            location: role.location.trim(),
            start: role.start.trim(),
            end: role.end.trim(),
          })),
        })),
      }
    : emptyProfile()

  const builtRoles = roles.map((role) => {
    const children: BulletNode[] = []
    const seen = new Set<string>()
    const seenText = new Set<string>()
    for (const edge of edges) {
      if (edge.source !== role.id) continue
      const bullet = bulletById.get(edge.target)
      if (!bullet || bullet.data.hidden || used.has(bullet.id) || seen.has(bullet.id)) continue
      const textKey = bullet.data.text.trim().toLocaleLowerCase()
      if (textKey && seenText.has(textKey)) continue
      seen.add(bullet.id)
      if (textKey) seenText.add(textKey)
      children.push(bullet)
    }
    children.sort(byPosition)
    for (const child of children) used.add(child.id)

    return {
      id: role.id,
      title: role.data.title.trim(),
      company: role.data.company.trim(),
      location: role.data.location.trim(),
      start: role.data.start.trim(),
      end: role.data.end.trim(),
      bullets: children.map((child) => {
        const ability = child.data.ability.trim()
        const skills = child.data.skills.map((skill) => skill.trim()).filter(Boolean)
        addSkillGroup(groups, ability, skills)
        return {
          id: child.id,
          text: child.data.text.trim(),
          ability,
          skills,
        }
      }),
    }
  })

  const educationNode = nodes.find(isEducationNode)
  const sectionContent = context ? sectionBlocks(nodes, context) : { blocks: [], skills: [] }
  // Skills shown in other sections (a project's stack…) count for the Skills section too.
  addSkillGroup(groups, '', sectionContent.skills)
  const skillGroups = [...groups.values()]
    .filter((group) => group.skills.length > 0)
    .map((group) => ({ ability: group.ability, skills: group.skills }))
  return {
    profile,
    summary: summary.trim(),
    skills: uniqueSkills([...builtRoles.flatMap((role) => role.bullets.flatMap((bullet) => bullet.skills)), ...sectionContent.skills]),
    roles: builtRoles,
    education: educationNode ? filledEducation(educationNode.data.entries) : null,
    blocks: sectionContent.blocks,
    skillGroups,
  }
}

/** The CV's own sections (projects, certifications…): their chosen entries with linked experiences, and those experiences' skills. */
function sectionBlocks(nodes: ResumeNode[], { sections, bank }: BuildContext): { blocks: SnapshotBlock[]; skills: string[] } {
  const skills: string[] = []
  const blocks = nodes
    .filter(isSectionNode)
    .sort(byPosition)
    .flatMap((node) => {
      const section = sections.find((item) => item.id === node.data.sectionId)
      if (!section || PROFILE_SECTIONS.includes(section.id)) return []
      const entryIds = node.data.entryIds ? new Set(node.data.entryIds) : null
      const experienceIds = node.data.experienceIds ? new Set(node.data.experienceIds) : null
      const entries = (section.entries ?? [])
        .filter((entry) => !entryIds || entryIds.has(entry.id))
        .flatMap((entry): TextEntry[] => {
          const title = entry.title.trim()
          const subtitle = entry.subtitle.trim()
          const location = entry.location.trim()
          const description = entry.description.trim()
          const dates = [entry.start.trim(), entry.end.trim()].filter(Boolean).join(' – ')
          const linked = bank.filter((item) => item.entryId === entry.id && (!experienceIds || experienceIds.has(item.id)))
          skills.push(...linked.flatMap((item) => item.skills))
          const bullets = linked.map((item) => item.text.trim()).filter(Boolean)
          const text = [[title, subtitle].filter(Boolean).join(' — '), location, dates].filter(Boolean).join(' · ') || description
          if (!text && bullets.length === 0) return []
          return [{
            id: entry.id,
            text: text || bullets[0],
            ...(title ? { title } : {}),
            ...(subtitle ? { subtitle } : {}),
            ...(location ? { location } : {}),
            ...(dates ? { dates } : {}),
            ...(description ? { description } : {}),
            ...(bullets.length > 0 ? { bullets } : {}),
          }]
        })
      return entries.length > 0 ? [{ id: section.id, name: section.name.trim() || 'Sección', entries }] : []
    })
  return { blocks, skills }
}

function filledEducation(entries: EducationEntry[]) {
  return entries.flatMap((entry) => {
    const next = {
      id: entry.id,
      school: entry.school.trim(),
      degree: entry.degree.trim(),
      start: entry.start.trim(),
      end: entry.end.trim(),
    }
    if (!next.school && !next.degree && !next.start && !next.end) return []
    return [next]
  })
}

function uniqueSkills(skills: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const skill of skills) {
    const name = skill.trim()
    const key = name.toLocaleLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    result.push(name)
  }
  return result
}

function addSkillGroup(
  groups: Map<string, { ability: string; skills: string[]; seen: Set<string> }>,
  ability: string,
  skills: string[],
) {
  if (skills.length === 0) return
  const key = ability.toLocaleLowerCase() || 'skills'
  let group = groups.get(key)
  if (!group) {
    group = { ability: ability || 'Skills', skills: [], seen: new Set() }
    groups.set(key, group)
  }
  for (const skill of skills) {
    const skillKey = skill.toLocaleLowerCase()
    if (group.seen.has(skillKey)) continue
    group.seen.add(skillKey)
    group.skills.push(skill)
  }
}

export function knownSkills(nodes: ResumeNode[], graphs: RoleGraph[]): string[] {
  const seen = new Set<string>()
  const skills: string[] = []
  const add = (skill: string) => {
    const name = skill.trim()
    const key = name.toLocaleLowerCase()
    if (!name || seen.has(key)) return
    seen.add(key)
    skills.push(name)
  }
  for (const preset of experienceCatalog) preset.skills.forEach(add)
  for (const node of nodes) {
    if (node.type === 'bullet' || node.type === 'skills') node.data.skills.forEach(add)
  }
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      if (node.type === 'bullet') node.data.skills.forEach(add)
    }
  }
  skills.sort((left, right) => left.localeCompare(right))
  return skills
}

export function cloneRoleGraph(graph: RoleGraph, origin: { x: number; y: number }): { nodes: ResumeNode[]; edges: ResumeEdge[] } {
  const role = graph.nodes.find(isRoleNode)
  const dx = origin.x - (role?.position.x ?? 0)
  const dy = origin.y - (role?.position.y ?? 0)
  const idMap = new Map<string, string>()
  const nodes: ResumeNode[] = []
  for (const node of graph.nodes) {
    if (node.type !== 'role' && node.type !== 'bullet') continue
    const id = crypto.randomUUID()
    idMap.set(node.id, id)
    const position = { x: node.position.x + dx, y: node.position.y + dy }
    if (node.type === 'role') {
      nodes.push({ ...node, id, position, data: { ...node.data }, selected: true })
    } else {
      nodes.push({ ...node, id, position, data: { ...node.data, skills: [...node.data.skills] }, selected: false })
    }
  }
  const edges: ResumeEdge[] = []
  for (const edge of graph.edges) {
    const source = idMap.get(edge.source)
    const target = idMap.get(edge.target)
    if (!source || !target) continue
    edges.push({ id: `e-${source}-${target}`, source, target })
  }
  return { nodes, edges }
}

function byPosition<T extends { id: string; position: { x: number; y: number } }>(a: T, b: T) {
  if (a.position.y !== b.position.y) return a.position.y - b.position.y
  if (a.position.x !== b.position.x) return a.position.x - b.position.x
  return a.id.localeCompare(b.id)
}
