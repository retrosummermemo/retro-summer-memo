/**
 * A CV as a selection: which experiences, entries and sections it shows. The graph (the canvas in
 * the app) is derived from it, so callers never place nodes by hand: roles come in profile order
 * with their chosen experiences, then education, then the other sections.
 */
import { findSection, sectionsView } from './content'
import { buildCvVersion, rememberGraph } from './documentOps'
import type { Experience } from './experiences'
import { defaultFontSize, defaultMargin, type FontId } from './fonts'
import {
  arrangeNodes,
  personalGraph,
  type BulletNode,
  type Cv,
  type EducationNode,
  type ResumeDocument,
  type ResumeEdge,
  type ResumeNode,
  type RoleNode,
  type SectionNode,
} from './model'
import type { TemplateId } from './templates'

export type CvRequest = {
  /** Rebuild this CV; a new one is created when absent. */
  cvId?: string
  /** Id for the new CV (default: a random one). */
  newId?: string
  title?: string
  position?: string
  company?: string
  posting?: string
  summary?: string
  templateId?: TemplateId
  fontId?: FontId
  /** Experiences to show, each under the entry it is linked to, in this order. */
  experienceIds: string[]
  /**
   * Entries to show (of any section). Default: every role and every study, plus the entries of other
   * sections that have chosen experiences.
   */
  entryIds?: string[]
  /** Other sections to include, in order (ids or names). Default: those with chosen entries. All their entries show unless entryIds says otherwise. */
  sectionIds?: string[]
  /** Default true. */
  includeEducation?: boolean
}

export type CvOutline = {
  roles: { title: string; company: string; dates: string; experiences: number }[]
  education: number
  sections: { name: string; entries: number }[]
  /** Chosen experiences that are not linked to a shown entry, so they were left out. */
  unplaced: { id: string; text: string }[]
}

export function cvGraph(document: ResumeDocument, request: CvRequest) {
  const views = sectionsView(document)
  const chosen = request.experienceIds
    .map((id) => document.bank.find((item) => item.id === id))
    .filter((item): item is Experience => Boolean(item))
  const onlyEntries = request.entryIds ? new Set(request.entryIds) : null
  const placed = new Set<string>()
  const nodes: ResumeNode[] = [...personalGraph(document.profile).nodes]
  const edges: ResumeEdge[] = []
  const enabled = ['personal']

  // Experience: roles in profile order, each with its chosen experiences.
  const roles = (views.find((view) => view.id === 'experience')?.entries ?? []).filter((entry) => !onlyEntries || onlyEntries.has(entry.id))
  roles.forEach((role, index) => {
    const roleNode: RoleNode = {
      id: crypto.randomUUID(),
      type: 'role',
      position: { x: 48, y: 280 + index },
      data: { title: role.title, company: role.subtitle, location: role.location, start: role.start, end: role.end },
    }
    nodes.push(roleNode)
    chosen
      .filter((item) => item.entryId === role.id)
      .forEach((item, order) => {
        const bullet: BulletNode = {
          id: crypto.randomUUID(),
          type: 'bullet',
          position: { x: 400, y: 280 + index + order / 1000 },
          data: { text: item.text, ability: '', skills: [...item.skills] },
        }
        nodes.push(bullet)
        edges.push({ id: `e-${roleNode.id}-${bullet.id}`, source: roleNode.id, target: bullet.id })
        placed.add(item.id)
      })
  })
  if (roles.length > 0) enabled.push('experience')

  // Education: the profile's studies.
  const studies = document.profile.education.filter((entry) => !onlyEntries || onlyEntries.has(entry.id))
  if (request.includeEducation !== false && studies.length > 0) {
    const education: EducationNode = { id: crypto.randomUUID(), type: 'education', position: { x: 400, y: 48 }, data: { entries: studies } }
    nodes.push(education)
    enabled.push('education')
  }
  if (chosen.some((item) => item.skills.length > 0)) enabled.push('skills')

  // Other sections: the ones asked for, or the ones with chosen experiences or entries.
  const others = views.filter((view) => view.source === 'section')
  const wanted = request.sectionIds
    ? request.sectionIds.flatMap((value) => {
        const section = findSection(document, value)
        return others.filter((view) => view.id === section?.id)
      })
    : others.filter((view) => view.entries.some((entry) => onlyEntries?.has(entry.id) || chosen.some((item) => item.entryId === entry.id)))
  wanted.forEach((view, index) => {
    const listed = request.sectionIds && !onlyEntries ? null : view.entries.filter((entry) => onlyEntries?.has(entry.id) || chosen.some((item) => item.entryId === entry.id))
    const shown = listed ?? view.entries
    const experiences = chosen.filter((item) => shown.some((entry) => entry.id === item.entryId))
    for (const item of experiences) placed.add(item.id)
    const node: SectionNode = {
      id: crypto.randomUUID(),
      type: 'section',
      position: { x: 48, y: 100_000 + index * 150 },
      data: { sectionId: view.id, ...(listed ? { entryIds: listed.map((entry) => entry.id) } : {}), experienceIds: experiences.map((item) => item.id) },
    }
    nodes.push(node)
    enabled.push(view.id)
  })

  return {
    nodes: arrangeNodes(nodes, edges),
    edges,
    enabledSections: enabled,
    unplaced: chosen.filter((item) => !placed.has(item.id)).map((item) => ({ id: item.id, text: item.text })),
  }
}

/** Creates or rebuilds a CV from a selection and generates its version. */
export function buildCv(
  document: ResumeDocument,
  request: CvRequest,
  now: Date = new Date(),
): { document: ResumeDocument; cvId: string; versionId: string; outline: CvOutline } {
  const graph = cvGraph(document, request)
  const existing = request.cvId ? document.cvs.find((cv) => cv.id === request.cvId) : undefined
  if (request.cvId && !existing) throw new Error(`No existe el CV ${request.cvId}.`)
  const templateId = request.templateId ?? existing?.templateId ?? 'classic'
  const cv: Cv = {
    ...(existing ?? {
      id: request.newId ?? crypto.randomUUID(),
      title: '',
      position: '',
      company: '',
      posting: '',
      summary: '',
      templateId,
      fontId: request.fontId ?? 'times',
      fontSize: defaultFontSize(templateId),
      lineHeight: 1.15,
      marginId: defaultMargin(templateId),
      pageSize: 'letter',
      // Compact skills keep the CV short and read well in screening software.
      skillsFormat: 'comma',
      enabledSections: [],
      versions: [],
    }),
    ...(request.title !== undefined ? { title: request.title.trim() || 'Sin título' } : {}),
    ...(request.position !== undefined ? { position: request.position } : {}),
    ...(request.company !== undefined ? { company: request.company } : {}),
    ...(request.posting !== undefined ? { posting: request.posting } : {}),
    ...(request.summary !== undefined ? { summary: request.summary } : {}),
    ...(request.templateId ? { templateId: request.templateId } : {}),
    ...(request.fontId ? { fontId: request.fontId } : {}),
    enabledSections: graph.enabledSections,
    nodes: graph.nodes,
    edges: graph.edges,
  }
  if (!cv.title) cv.title = [cv.position, cv.company].filter(Boolean).join(' — ') || 'Sin título'

  const cvs = existing ? rememberGraph(document).map((item) => (item.id === cv.id ? cv : item)) : [...rememberGraph(document), cv]
  const withCv: ResumeDocument = { ...document, cvs, activeCvId: cv.id, nodes: cv.nodes, edges: cv.edges }
  const { document: built, versionId } = buildCvVersion(withCv, cv.id, { now })
  const snapshot = built.cvs.find((item) => item.id === cv.id)!.versions.at(-1)!.snapshot
  return {
    document: built,
    cvId: cv.id,
    versionId,
    outline: {
      roles: snapshot.roles.map((role) => ({
        title: role.title,
        company: role.company,
        dates: [role.start, role.end].filter(Boolean).join(' – '),
        experiences: role.bullets.length,
      })),
      education: snapshot.education?.length ?? 0,
      sections: (snapshot.blocks ?? []).map((block) => ({ name: block.name, entries: block.entries.length })),
      unplaced: graph.unplaced,
    },
  }
}
