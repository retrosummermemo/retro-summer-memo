import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type OnEdgesChange,
  type OnNodesChange,
  type XYPosition,
} from '@xyflow/react'
import { type Experience } from '../domain/experiences'
import { GraphCanvas, loadGraphPanelsOpen, type GraphPanelsOpen } from './components/GraphCanvas'
import { NewCvWizard, type ComposerSeed } from './components/NewCvWizard'
import { PersonalData } from './components/PersonalData'
import { MyCvs, type NewCvInput } from './components/cvs/MyCvs'
import { ProfilePage } from './components/profile/ProfilePage'
import { ApplicationCvStart } from './components/applications/ApplicationCvStart'
import { useRoute, type Section } from './routes'
import { buildCv } from '../domain/cvBuilder'
import { assignCv, copyCv, cvOfApplication, markSentVersion } from '../domain/cvLibrary'
import {
  buildCvVersion,
  deleteCv as deleteCvDocument,
  openCvGraph,
  writeProfile,
  type CvDraft,
} from '../domain/documentOps'
import { Applications, type TrackerData } from './components/applications/Applications'
import { updateApplication, type Application } from '../domain/applications'
import { ResumePreview } from './components/ResumePreview'
import { CvEditor } from './components/editor/CvEditor'
import { Sidebar } from './components/Sidebar'
import { downloadDoc, downloadPdf } from './download'
import { ExperienceMaster } from './components/Master'
import { Library } from './components/Templates'
import {
  activeCv,
  arrangeNodes,
  buildResume,
  cloneRoleGraph,
  nextPosition,
  roleHasExperience,
  type BulletData,
  type BulletNode,
  type Cv,
  type EducationData,
  type EducationNode,
  type PersonNode,
  type CatalogSection,
  type Profile,
  type ResumeDocument,
  type ResumeNode,
  type RoleData,
  type RoleGraph,
  type RoleNode,
  type SkillsData,
  type Snapshot,
} from '../domain/model'
import type { DocumentStore } from '../ports/documentStore'
import { useDocumentSync } from './useDocumentSync'
import { deleteExperiences, saveExperience, sectionsView } from '../domain/content'
import { toggleCvSection, withEnabledSectionNodes } from '../domain/cvEditing'
import type { OAuthConsent } from '../ports/auth'
import { ConnectAssistant, Onboarding } from './components/assistant/ConnectAssistant'
import { useConnectedApps } from './components/assistant/useConnectedApps'
import {
  fonts,
  fontSizes,
  margins,
  lineSpacings,
  spacingLabel,
  isFontId,
  isFontSize,
  isLineSpacing,
  isMarginId,
  isPageSize,
  pageSizes,
  type FontId,
  type FontSize,
  type LineSpacing,
  type MarginId,
  type PageSize,
} from '../domain/fonts'
import { type ExperienceLevel } from '../domain/experiences'
import { templates, type TemplateId } from '../domain/templates'

type ViewId = 'preview' | 'style' | 'graph' | 'table'
type Views = Record<ViewId, boolean>
type MainPane = 'graph' | 'preview'
type DockEdge = 'left' | 'right' | 'top' | 'bottom'
type WorkspaceLayout = { main: [MainPane, MainPane]; props: DockEdge }

const layoutKey = 'resume.layout.v1'
const editorModeKey = 'resume.editorMode.v1'

/** The visual editor, or the graph (the CV's experiences connected by hand). */
type EditorMode = 'editor' | 'graph'

function loadEditorMode(): EditorMode {
  try {
    return localStorage.getItem(editorModeKey) === 'graph' ? 'graph' : 'editor'
  } catch {
    return 'editor'
  }
}

/** Stand-in that keeps render paths total while no CV exists. Never stored, never shown. */
const NO_CV: Cv = {
  id: '',
  title: '',
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
  enabledSections: [],
  versions: [],
  nodes: [],
  edges: [],
}

function loadLayout(): WorkspaceLayout {
  const fallback: WorkspaceLayout = { main: ['graph', 'preview'], props: 'right' }
  try {
    const raw = JSON.parse(localStorage.getItem(layoutKey) ?? '')
    if (!raw || typeof raw !== 'object') return fallback
    const main = Array.isArray(raw.main) ? raw.main.filter((id: unknown): id is MainPane => id === 'graph' || id === 'preview') : []
    const props = raw.props === 'left' || raw.props === 'right' || raw.props === 'top' || raw.props === 'bottom' ? raw.props : fallback.props
    if (main.length !== 2 || main[0] === main[1]) return fallback
    return { main: [main[0], main[1]], props }
  } catch {
    return fallback
  }
}

type AppProps = {
  initialDocument: ResumeDocument
  store: DocumentStore
  /** Signed-in user, when the backend has accounts. */
  account?: { email: string; onSignOut: () => void }
  /** One-off message shown on open (e.g. data imported from this browser). */
  notice?: string
  /** Connecting assistants (ChatGPT, Claude…) through the MCP, when the backend offers it. */
  assistant?: AssistantAccess
}

export type AssistantAccess = { mcpUrl: string; access: OAuthConsent }

/** The open CV as it prints now, rebuilt only when its content changes; null when no editor shows it. */
function useDraft(editing: boolean, doc: ResumeDocument, summary: string): Snapshot | null {
  const { nodes, edges, sections, bank } = doc
  return useMemo(() => (editing ? buildResume(nodes, edges, summary, { sections, bank }) : null), [editing, nodes, edges, summary, sections, bank])
}

/** Nothing loaded yet: the account was just created. */
function isEmptyAccount(document: ResumeDocument) {
  return (
    !document.profile.name.trim() &&
    document.profile.jobs.length === 0 &&
    document.bank.length === 0 &&
    document.cvs.length === 0 &&
    document.applications.length === 0
  )
}

export default function App({ initialDocument, store, account, notice, assistant }: AppProps) {
  const { doc, setDoc, status: saveStatus, retry: retrySave } = useDocumentSync(store, initialDocument)
  const [noticeOpen, setNoticeOpen] = useState(Boolean(notice))
  const [assistantOpen, setAssistantOpen] = useState(false)
  const connections = useConnectedApps(assistant?.access)
  const assistantConnected = (connections.apps?.length ?? 0) > 0
  const [route, navigate] = useRoute()
  const [libraryKey, setLibraryKey] = useState(0)
  /** The new-CV wizard (a CV from a posting); from an application, the CV it makes is that application's. */
  const [wizard, setWizard] = useState<{ seed: ComposerSeed | null; applicationId?: string } | null>(null)
  const [views, setViews] = useState<Views>({ preview: true, style: false, graph: true, table: false })
  const [graphPanels, setGraphPanels] = useState<GraphPanelsOpen>(loadGraphPanelsOpen)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [fitToken, setFitToken] = useState(0)
  const [previewShare, setPreviewShare] = useState(45)
  const [layout, setLayout] = useState<WorkspaceLayout>(loadLayout)
  const [editorMode, setEditorMode] = useState<EditorMode>(loadEditorMode)
  const [dragging, setDragging] = useState<ViewId | null>(null)
  const [dropPane, setDropPane] = useState<MainPane | null>(null)
  const [dropEdge, setDropEdge] = useState<DockEdge | null>(null)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const draggingRef = useRef<ViewId | null>(null)
  const metadataRef = useRef<HTMLDivElement>(null)
  const downloadRef = useRef<HTMLDivElement>(null)
  const viewsRef = useRef<HTMLDetailsElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem(layoutKey, JSON.stringify(layout))
  }, [layout])

  useEffect(() => {
    try {
      localStorage.setItem(editorModeKey, editorMode)
    } catch {
      /* ignore */
    }
  }, [editorMode])

  useEffect(() => {
    if (!metadataOpen) return
    function onPointer(event: PointerEvent) {
      if (!metadataRef.current?.contains(event.target as Node)) setMetadataOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [metadataOpen])

  useEffect(() => {
    if (!downloadOpen) return
    function onPointer(event: PointerEvent) {
      if (!downloadRef.current?.contains(event.target as Node)) setDownloadOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setDownloadOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [downloadOpen])

  useEffect(() => {
    function closeViewsOutside(event: PointerEvent) {
      if (!viewsRef.current?.contains(event.target as Node)) viewsRef.current?.removeAttribute('open')
    }
    function closeViewsOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') viewsRef.current?.removeAttribute('open')
    }
    window.addEventListener('pointerdown', closeViewsOutside)
    window.addEventListener('keydown', closeViewsOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeViewsOutside)
      window.removeEventListener('keydown', closeViewsOnEscape)
    }
  }, [])

  // What the URL points at: an application (and its own CV, on the CV tab) or a CV.
  const routeApplication = route.page === 'applications' && route.applicationId ? doc.applications.find((item) => item.id === route.applicationId) : undefined
  const applicationCv = routeApplication && route.page === 'applications' && route.tab === 'cv' ? cvOfApplication(doc, routeApplication.id) : undefined
  const routeCv = route.page === 'cvs' && route.cvId ? doc.cvs.find((item) => item.id === route.cvId) : undefined
  const wantedCvId = routeCv?.id ?? applicationCv?.id

  // The CV on screen is the open one (its graph lives at the document root): open the one the URL
  // asks for (back and forward, a shared link, a CV the assistant just made for this application).
  // Adjusted while rendering, so the previous CV never shows under the new address.
  if (wantedCvId && doc.activeCvId !== wantedCvId) {
    setDoc((current) => withEnabledSectionNodes(openCvGraph(current, wantedCvId)))
    if (selectedVersionId !== null) setSelectedVersionId(null)
  }

  // A link to something that no longer exists goes to its list instead.
  const missing = (route.page === 'cvs' && route.cvId && !routeCv) || (route.page === 'applications' && route.applicationId && !routeApplication)
  useEffect(() => {
    if (missing) navigate({ page: route.page === 'cvs' ? 'cvs' : 'applications' }, { replace: true })
  }, [missing, route.page, navigate])

  const openedCv = activeCv(doc)
  const inWorkspace = routeCv !== undefined && doc.activeCvId === routeCv.id
  const inApplicationCv = applicationCv !== undefined && doc.activeCvId === applicationCv.id
  const cv = openedCv ?? NO_CV
  const snapshot = shownSnapshot(cv, selectedVersionId)
  const versionNote = olderVersionNote(cv, selectedVersionId)
  // The editor shows the CV live: built from its content on every change (versions are fixed copies).
  const editing = inWorkspace || inApplicationCv
  const draft = useDraft(editing, doc, cv.summary)
  const inEditor = inWorkspace && editorMode === 'editor'
  const editorShown = inEditor || inApplicationCv ? cv.versions.find((version) => version.id === selectedVersionId)?.snapshot ?? draft : null
  const split = views.preview && views.graph

  const onNodesChange: OnNodesChange<ResumeNode> = (changes) => {
    setDoc((current) => ({ ...current, nodes: applyNodeChanges(changes, current.nodes) }))
  }

  const onEdgesChange: OnEdgesChange = (changes) => {
    setDoc((current) => ({ ...current, edges: applyEdgeChanges(changes, current.edges) }))
  }

  function onConnect(connection: Connection) {
    if (!connection.source || !connection.target) return
    setDoc((current) => {
      const source = current.nodes.find((node) => node.id === connection.source)
      const target = current.nodes.find((node) => node.id === connection.target)
      if (source?.type !== 'role' || target?.type !== 'bullet') return current
      if (roleHasExperience(current.nodes, current.edges, source.id, target.data.text, target.id)) return current
      const withoutTarget = current.edges.filter((edge) => edge.target !== connection.target)
      return {
        ...current,
        edges: addEdge({ ...connection, id: `e-${connection.source}-${connection.target}` }, withoutTarget),
      }
    })
  }

  function addRole(data: RoleData, position?: XYPosition) {
    setDoc((current) => {
      const node: RoleNode = {
        id: crypto.randomUUID(),
        type: 'role',
        position: position ?? nextPosition(current.nodes, 'role'),
        data,
        selected: true,
      }
      return { ...current, nodes: [...current.nodes.map(deselect), node] }
    })
  }

  function useRoleGraph(id: string, position: XYPosition) {
    setDoc((current) => {
      const graph = current.roleGraphs.find((item) => item.id === id)
      if (!graph) return current
      const copy = cloneRoleGraph(graph, position)
      return {
        ...current,
        nodes: [...current.nodes.map(deselect), ...copy.nodes],
        edges: [...current.edges, ...copy.edges],
      }
    })
  }

  function addSkillName(_skill: string, _position?: XYPosition) {
    // Skills are metadata on Skill nodes; the Skills CV section aggregates them on Build.
  }

  function changeRoleGraphs(roleGraphs: RoleGraph[]) {
    setDoc((current) => ({ ...current, roleGraphs }))
  }

  function setKnowledge(id: string, level: ExperienceLevel | null) {
    setDoc((current) => {
      const knowledge = current.knowledge.filter((answer) => answer.id !== id)
      if (level === null) return { ...current, knowledge }
      return { ...current, knowledge: [...knowledge, { id, level }] }
    })
  }

  function applyKnowledge(updates: { id: string; level: ExperienceLevel }[]) {
    if (updates.length === 0) return
    setDoc((current) => {
      const map = new Map(current.knowledge.map((answer) => [answer.id, answer.level]))
      for (const update of updates) map.set(update.id, update.level)
      return {
        ...current,
        knowledge: [...map.entries()].map(([id, level]) => ({ id, level })),
      }
    })
  }

  function addExperience(preset: Experience, position?: XYPosition, sourceId?: string) {
    setDoc((current) => {
      if (sourceId && roleHasExperience(current.nodes, current.edges, sourceId, preset.text)) return current
      const id = crypto.randomUUID()
      const node: BulletNode = {
        id,
        type: 'bullet',
        position: position ?? nextPosition(current.nodes, 'bullet'),
        data: { text: preset.text, ability: '', skills: [...preset.skills] },
        selected: true,
      }
      const edges = sourceId
        ? addEdge(
            { id: `e-${sourceId}-${id}`, source: sourceId, target: id, sourceHandle: 'out', targetHandle: 'in' },
            current.edges.filter((edge) => edge.target !== id),
          )
        : current.edges
      return { ...current, nodes: [...current.nodes.map(deselect), node], edges }
    })
  }

  function addPerson(position?: XYPosition) {
    setDoc((current) => {
      if (current.nodes.some((node) => node.type === 'person')) return current
      const node: PersonNode = {
        id: crypto.randomUUID(),
        type: 'person',
        position: position ?? { x: 48, y: 48 },
        data: { ...current.profile },
        selected: true,
      }
      return { ...current, nodes: [...current.nodes.map(deselect), node] }
    })
  }

  function arrange() {
    setDoc((current) => ({ ...current, nodes: arrangeNodes(current.nodes, current.edges) }))
    setFitToken((token) => token + 1)
  }

  function cleanGraph() {
    setDoc((current) => {
      const nodesById = new Map(current.nodes.map((node) => [node.id, node]))
      const bulletRoleLinks = new Map<string, Set<string>>()
      for (const edge of current.edges) {
        const target = nodesById.get(edge.target)
        const source = nodesById.get(edge.source)
        if (target?.type !== 'bullet' || source?.type !== 'role') continue
        const roles = bulletRoleLinks.get(target.id) ?? new Set<string>()
        roles.add(source.id)
        bulletRoleLinks.set(target.id, roles)
      }
      const conflictedBulletIds = new Set<string>()
      for (const [bulletId, roleIds] of bulletRoleLinks) {
        if (roleIds.size > 1) conflictedBulletIds.add(bulletId)
      }
      for (const role of current.nodes) {
        if (role.type !== 'role') continue
        const seenTexts = new Set<string>()
        for (const edge of current.edges) {
          if (edge.source !== role.id) continue
          const bullet = nodesById.get(edge.target)
          if (bullet?.type !== 'bullet') continue
          const text = bullet.data.text.trim().toLocaleLowerCase()
          if (!text) continue
          if (seenTexts.has(text)) conflictedBulletIds.add(bullet.id)
          else seenTexts.add(text)
        }
      }
      const emptyRoleIds = new Set(
        current.nodes
          .filter((node) => node.type === 'role' && (
            node.data.pending ||
            !current.edges.some((edge) =>
              edge.source === node.id &&
              !conflictedBulletIds.has(edge.target) &&
              nodesById.get(edge.target)?.type === 'bullet',
            ) ||
            (!node.data.title.trim() && !node.data.company.trim() && !node.data.start.trim() && !node.data.end.trim())
          ))
          .map((node) => node.id),
      )
      const linkedBullets = new Set(
        [...bulletRoleLinks]
          .filter(([bulletId, roleIds]) =>
            !conflictedBulletIds.has(bulletId) && [...roleIds].some((roleId) => !emptyRoleIds.has(roleId)),
          )
          .map(([bulletId]) => bulletId),
      )
      const orphanBulletIds = new Set(
        current.nodes
          .filter((node) => node.type === 'bullet' && (!linkedBullets.has(node.id) || !node.data.text.trim()))
          .map((node) => node.id),
      )
      const removed = new Set([...emptyRoleIds, ...orphanBulletIds, ...conflictedBulletIds])
      if (removed.size === 0) return current
      return {
        ...current,
        nodes: current.nodes.filter((node) => !removed.has(node.id)),
        edges: current.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
      }
    })
  }

  function updateRole(id: string, patch: Partial<RoleData>) {
    setDoc((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.type === 'role' && node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
      ),
    }))
  }

  function updateBullet(id: string, patch: Partial<BulletData>) {
    setDoc((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.type === 'bullet' && node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
      ),
    }))
  }

  function updateSkills(id: string, patch: Partial<SkillsData>) {
    setDoc((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.type === 'skills' && node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
      ),
    }))
  }

  function toggleHidden(id: string) {
    setDoc((current) => {
      const node = current.nodes.find((item) => item.id === id)
      if (!node || (node.type !== 'bullet' && node.type !== 'person' && node.type !== 'skills')) return current
      const hidden = node.data.hidden ? undefined : true
      return {
        ...current,
        profile: node.type === 'person' ? { ...current.profile, hidden } : current.profile,
        nodes: current.nodes.map((item) => {
          if (item.id !== id) return item
          if (item.type === 'person') return { ...item, data: { ...item.data, hidden } }
          if (item.type === 'bullet') return { ...item, data: { ...item.data, hidden } }
          if (item.type === 'skills') return { ...item, data: { ...item.data, hidden } }
          return item
        }),
      }
    })
  }

  function updatePerson(id: string, patch: Partial<Profile>) {
    setDoc((current) => {
      const node = current.nodes.find((item) => item.id === id && item.type === 'person')
      if (!node) return current
      return writeProfile(current, { ...current.profile, ...patch })
    })
  }

  function updateProfile(patch: Partial<Profile>) {
    setDoc((current) => writeProfile(current, { ...current.profile, ...patch }))
  }

  function deleteNode(id: string) {
    setDoc((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== id),
      edges: current.edges.filter((edge) => edge.source !== id && edge.target !== id),
    }))
  }

  function deleteEdge(id: string) {
    setDoc((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== id) }))
  }

  function selectNode(id: string) {
    setDoc((current) => ({
      ...current,
      nodes: current.nodes.map((node) => ({ ...node, selected: node.id === id })),
    }))
  }

  function updateCvMeta(patch: Partial<Pick<Cv, 'title' | 'position' | 'company' | 'posting' | 'summary'>>) {
    setDoc((current) => ({
      ...current,
      cvs: current.cvs.map((item) => (item.id === current.activeCvId ? { ...item, ...patch } : item)),
    }))
  }

  function updateBank(bank: Experience[]) {
    setDoc((current) => ({ ...current, bank }))
  }

  function openCv(id: string) {
    setDoc((current) => withEnabledSectionNodes(openCvGraph(current, id)))
    setSelectedVersionId(null)
    setMetadataOpen(false)
    setWizard(null)
    navigate({ page: 'cvs', cvId: id })
  }

  /** Opens the CV tab of an application (its CV opens with it). */
  function openApplicationCv(applicationId: string) {
    const own = cvOfApplication(doc, applicationId)
    if (own) setDoc((current) => withEnabledSectionNodes(openCvGraph(current, own.id)))
    setSelectedVersionId(null)
    navigate({ page: 'applications', applicationId, tab: 'cv' })
  }

  /**
   * The wizard's CV: a general one, or the CV of the application it was opened from. Each chosen
   * experience goes under the role or project where it happened.
   */
  function createCv(draft: CvDraft) {
    const id = crypto.randomUUID()
    const forApplication = wizard?.applicationId
    setDoc((current) => {
      const { document } = buildCv(current, {
        newId: id,
        title: draft.title,
        position: draft.position,
        company: draft.company,
        posting: draft.posting,
        templateId: draft.templateId,
        fontId: draft.fontId,
        experienceIds: draft.experienceIds,
      })
      return forApplication && current.applications.some((application) => application.id === forApplication) ? assignCv(document, id, forApplication) : document
    })
    setSelectedVersionId(null)
    setMetadataOpen(false)
    setWizard(null)
    setViews((current) => ({ ...current, preview: true, graph: true }))
    navigate(forApplication ? { page: 'applications', applicationId: forApplication, tab: 'cv' } : { page: 'cvs', cvId: id })
  }

  /** "Nuevo CV" in Mis CVs: a general CV from the whole profile, its structure only, or a copy. */
  function createGeneralCv(input: NewCvInput) {
    const id = crypto.randomUUID()
    setDoc((current) => {
      if (input.start.kind === 'copy') {
        const copied = copyCv(current, input.start.cvId, { id, title: input.title }).document
        const positioned = input.position ? { ...copied, cvs: copied.cvs.map((item) => (item.id === id ? { ...item, position: input.position } : item)) } : copied
        return withEnabledSectionNodes(openCvGraph(positioned, id))
      }
      const levels = new Map(current.knowledge.map((answer) => [answer.id, answer.level]))
      const experienceIds =
        input.start.kind === 'profile' ? current.bank.filter((item) => item.entryId && levels.get(item.id) !== 0).map((item) => item.id) : []
      return buildCv(current, { newId: id, title: input.title, position: input.position, experienceIds }).document
    })
    setSelectedVersionId(null)
    navigate({ page: 'cvs', cvId: id })
  }

  /** The CV of an application, as a copy of a general CV. */
  function copyForApplication(applicationId: string, cvId: string) {
    const id = crypto.randomUUID()
    setDoc((current) => {
      if (cvOfApplication(current, applicationId)) return current
      return withEnabledSectionNodes(openCvGraph(copyCv(current, cvId, { id, applicationId }).document, id))
    })
    setSelectedVersionId(null)
  }

  function changeTracker(update: (current: TrackerData) => TrackerData) {
    setDoc((current) => ({
      ...current,
      ...update({ applications: current.applications, applicationStatuses: current.applicationStatuses, companies: current.companies }),
    }))
  }

  /** New-CV wizard prefilled from a job application; the CV it creates is that application's. */
  function buildCvFor(application: Application) {
    setWizard({
      applicationId: application.id,
      seed: {
        title: [application.company, application.title].filter(Boolean).join(' — '),
        position: application.title,
        company: application.company,
        posting: application.posting,
      },
    })
  }

  function deleteCv(id: string) {
    setDoc((current) => deleteCvDocument(current, id))
    if (route.page === 'cvs' && route.cvId === id) navigate({ page: 'cvs' })
  }

  function goTo(section: Section) {
    setWizard(null)
    setMetadataOpen(false)
    if (section === 'profile') {
      setLibraryKey((key) => key + 1)
      navigate({ page: 'profile', tab: 'personal' })
    } else {
      navigate({ page: section })
    }
  }

  function clearSelection() {
    setDoc((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
    }))
  }

  function addEducation(position?: XYPosition) {
    setDoc((current) => {
      if (current.nodes.some((node) => node.type === 'education')) return current
      const node: EducationNode = {
        id: crypto.randomUUID(),
        type: 'education',
        position: position ?? { x: 400, y: 48 },
        data: { entries: [] },
        selected: true,
      }
      return { ...current, nodes: [...current.nodes.map(deselect), node] }
    })
  }

  function updateEducation(id: string, patch: Partial<EducationData>) {
    setDoc((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === id && node.type === 'education' ? { ...node, data: { ...node.data, ...patch } } : node)),
    }))
  }

  function updateStyle(patch: Partial<Pick<Cv, 'fontId' | 'fontSize' | 'lineHeight' | 'marginId' | 'pageSize' | 'skillsFormat'>>) {
    setDoc((current) => ({
      ...current,
      cvs: current.cvs.map((item) => (item.id === current.activeCvId ? { ...item, ...patch } : item)),
    }))
  }

  function changeSections(update: (sections: CatalogSection[]) => CatalogSection[]) {
    setDoc((current) => {
      const sections = update(current.sections)
      const ids = new Set(sections.map((section) => section.id))
      return {
        ...current,
        sections,
        cvs: current.cvs.map((cv) => ({
          ...cv,
          enabledSections: cv.enabledSections.filter((id) => ids.has(id)),
        })),
      }
    })
  }

  function toggleSection(id: string) {
    setDoc((current) => toggleCvSection(current, id))
  }

  function updateTemplate(templateId: TemplateId) {
    setDoc((current) => ({
      ...current,
      cvs: current.cvs.map((item) => (item.id === current.activeCvId ? { ...item, templateId } : item)),
    }))
  }

  function build() {
    const versionId = crypto.randomUUID()
    setDoc((current) => buildCvVersion(current, current.activeCvId, { versionId }).document)
    setSelectedVersionId(versionId)
    setViews((current) => ({ ...current, preview: true }))
  }

  /** The editor's "Guardar versión": a fixed copy of the CV, while the editor keeps showing the draft. */
  function saveVersion() {
    setDoc((current) => buildCvVersion(current, current.activeCvId).document)
  }

  function toggleView(id: ViewId) {
    setViews((current) => ({ ...current, [id]: !current[id] }))
  }

  function onSashPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onSashPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const rect = workspaceRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const side = views.style && (layout.props === 'left' || layout.props === 'right')
    const styleWidth = side ? 240 : 0
    const available = rect.width - styleWidth
    if (available <= 0) return
    const origin = rect.left + (layout.props === 'left' && side ? styleWidth : 0)
    const leftShare = ((event.clientX - origin) / available) * 100
    const clamped = Math.min(78, Math.max(22, leftShare))
    setPreviewShare(layout.main[0] === 'preview' ? clamped : 100 - clamped)
  }

  function beginDrag(id: ViewId, event: ReactDragEvent<HTMLElement>) {
    draggingRef.current = id
    event.dataTransfer.setData('text/plain', id)
    event.dataTransfer.effectAllowed = 'move'
    setDragging(id)
  }

  function endDrag() {
    draggingRef.current = null
    setDragging(null)
    setDropPane(null)
    setDropEdge(null)
  }

  function swapMain() {
    setLayout((current) => ({ ...current, main: [current.main[1], current.main[0]] }))
  }

  const graph = {
    nodes: doc.nodes,
    edges: doc.edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    sections: doc.sections,
    enabledSections: cv.enabledSections,
    onToggleSection: toggleSection,
    onBuild: build,
    roleGraphs: doc.roleGraphs,
    bank: doc.bank,
    jobs: doc.profile.jobs,
    onAddRole: addRole,
    onUseRoleGraph: useRoleGraph,
    onAddSkillName: addSkillName,
    knowledge: doc.knowledge,
    onAddExperience: addExperience,
    onAddPerson: addPerson,
    onAddEducation: addEducation,
    onArrange: arrange,
    onCleanGraph: cleanGraph,
    onUpdateRole: updateRole,
    onUpdateBullet: updateBullet,
    onUpdatePerson: updatePerson,
    onUpdateSkills: updateSkills,
    onUpdateEducation: updateEducation,
    onDeleteNode: deleteNode,
    onToggleHidden: toggleHidden,
    onDeleteEdge: deleteEdge,
    onSelectNode: selectNode,
    onClearSelection: clearSelection,
    presentation: 'graph' as const,
    fitToken,
    panelsOpen: graphPanels,
    onPanelsOpenChange: setGraphPanels,
  }

  function mainDrag(id: MainPane) {
    return {
      onDragOver: (event: ReactDragEvent<HTMLElement>) => {
        const source = draggingRef.current
        if ((source !== 'graph' && source !== 'preview') || source === id) return
        event.preventDefault()
        setDropPane(id)
      },
      onDrop: (event: ReactDragEvent<HTMLElement>) => {
        event.preventDefault()
        const source = draggingRef.current
        if ((source === 'graph' || source === 'preview') && source !== id) swapMain()
        endDrag()
      },
    }
  }

  const propsBar = layout.props === 'top' || layout.props === 'bottom'
  const stylePane = views.style ? (
    <section className="view-pane is-style" aria-label="Estilo">
      <div className="view-tab is-draggable" draggable onDragStart={(event) => beginDrag('style', event)} onDragEnd={endDrag}>
        <span className="view-grab">
          Estilo
        </span>
        <button type="button" className="view-close" aria-label="Cerrar estilo" onClick={() => toggleView('style')}>
          ×
        </button>
      </div>
      <StylePane
        bar={propsBar}
        templateId={cv.templateId}
        fontId={cv.fontId}
        fontSize={cv.fontSize}
        lineHeight={cv.lineHeight}
        marginId={cv.marginId}
      pageSize={cv.pageSize}
      skillsFormat={cv.skillsFormat ?? 'list'}
        onTemplate={updateTemplate}
        onChange={updateStyle}
      />
    </section>
  ) : null

  const exportSnapshot = snapshot?.placeholder
    ? { ...snapshot, profile: doc.profile.hidden ? { name: '', fields: [], education: [], jobs: [] } : doc.profile }
    : snapshot

  const previewPane = (
    <section
      className={dropPane === 'preview' ? 'view-pane is-preview is-drop' : 'view-pane is-preview'}
      aria-label="Vista previa"
      style={split ? { flex: 'none', width: `${previewShare}%` } : undefined}
      {...mainDrag('preview')}
    >
      <div className="view-tab is-draggable" draggable onDragStart={(event) => beginDrag('preview', event)} onDragEnd={endDrag}>
        <span className="view-grab">
          Vista previa
        </span>
        <button type="button" className="view-close" aria-label="Cerrar vista previa" onClick={() => toggleView('preview')}>
          ×
        </button>
      </div>
      <div className="view-body resume-pane">
        {versionNote ? <p className="version-note">{versionNote}</p> : null}
        <ResumePreview
          snapshot={exportSnapshot}
          templateId={cv.templateId}
          fontId={cv.fontId}
          fontSize={cv.fontSize}
          lineHeight={cv.lineHeight}
          marginId={cv.marginId}
          pageSize={cv.pageSize}
          skillsFormat={cv.skillsFormat ?? 'list'}
          accentColor={cv.accentColor}
          sectionOrder={cv.sectionOrder}
          enabledSections={cv.enabledSections}
          sections={doc.sections}
          blocks={snapshot?.blocks ?? []}
          highlightId={selectedBulletId(doc.nodes, snapshot)}
        />
      </div>
    </section>
  )

  const graphPane = (
    <section
      className={dropPane === 'graph' ? 'view-pane is-graph is-drop' : 'view-pane is-graph'}
      aria-label="Grafo"
      {...mainDrag('graph')}
    >
      <div className="view-tab is-draggable" draggable onDragStart={(event) => beginDrag('graph', event)} onDragEnd={endDrag}>
        <span className="view-grab">
          Grafo
        </span>
        <button type="button" className="view-close" aria-label="Cerrar grafo" onClick={() => toggleView('graph')}>
          ×
        </button>
      </div>
      <div className="view-body">
        <GraphCanvas {...graph} />
      </div>
    </section>
  )

  const tablePane = (
    <section className="view-pane is-graph" aria-label="Tabla">
      <div className="view-tab is-draggable" draggable onDragStart={(event) => beginDrag('graph', event)} onDragEnd={endDrag}>
        <span className="view-grab">
          Tabla
        </span>
        <button type="button" className="view-close" aria-label="Cerrar tabla" onClick={() => toggleView('table')}>
          ×
        </button>
      </div>
      <div className="view-body">
        <GraphCanvas {...graph} presentation="table" />
      </div>
    </section>
  )

  const assistantHint = assistant ? { connected: assistantConnected, onConnect: () => setAssistantOpen(true) } : undefined
  const openApplications = doc.applications.filter((application) => {
    const kind = doc.applicationStatuses.find((status) => status.id === application.statusId)?.kind
    return kind !== 'rejected' && kind !== 'withdrawn'
  }).length
  const basedOnTitle = cv.basedOn ? doc.cvs.find((item) => item.id === cv.basedOn)?.title ?? 'un CV borrado' : undefined

  // What prints (PDF download) while the editor is on screen: the CV as shown.
  const printSource = editorShown ? (
    <div className="print-source" aria-hidden="true">
      <ResumePreview
        snapshot={editorShown}
        templateId={cv.templateId}
        fontId={cv.fontId}
        fontSize={cv.fontSize}
        lineHeight={cv.lineHeight}
        marginId={cv.marginId}
        pageSize={cv.pageSize}
        skillsFormat={cv.skillsFormat ?? 'list'}
        accentColor={cv.accentColor}
        sectionOrder={cv.sectionOrder}
        enabledSections={cv.enabledSections}
        sections={doc.sections}
        blocks={editorShown.blocks ?? []}
      />
    </div>
  ) : null

  /** The CV tab of an application: its CV in the editor, or the general CVs to start it from. */
  function applicationCvTab(application: Application) {
    const own = cvOfApplication(doc, application.id)
    if (own) {
      // Opening it takes one render (see the effect above).
      if (!inApplicationCv || !draft) return null
      return (
        <>
          <CvEditor
            doc={doc}
            cv={cv}
            draft={draft}
            setDoc={setDoc}
            saveStatus={saveStatus}
            onRetrySave={retrySave}
            selectedVersionId={selectedVersionId}
            onSelectVersion={setSelectedVersionId}
            onSaveVersion={saveVersion}
            onGraph={() => {
              setSelectedVersionId(null)
              setEditorMode('graph')
              navigate({ page: 'cvs', cvId: own.id })
            }}
            application={application}
            onMarkSent={(versionId) => setDoc((current) => markSentVersion(current, application.id, own.id, versionId))}
            basedOnTitle={basedOnTitle}
            assistant={assistantHint}
          />
          {printSource}
        </>
      )
    }
    return (
      <ApplicationCvStart
        application={application}
        doc={doc}
        onCopyFrom={(cvId) => copyForApplication(application.id, cvId)}
        onFromPosting={() => buildCvFor(application)}
        onOpenCv={openCv}
        onRecordSent={(attachment) =>
          setDoc((current) => ({
            ...current,
            applications: current.applications.map((item) => (item.id === application.id ? updateApplication(item, { attachment }) : item)),
          }))
        }
        assistant={assistantHint}
      />
    )
  }

  return (
    <div className="app">
      <Sidebar
        section={route.page}
        onNavigate={goTo}
        counts={{ applications: openApplications, cvs: doc.cvs.length }}
        save={saveStatus}
        onRetrySave={retrySave}
        account={account}
        assistant={assistant ? { connected: assistantConnected, onOpen: () => setAssistantOpen(true) } : undefined}
      />
      <div className="shell-main">
      {notice && noticeOpen ? (
        <div className="app-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="view-close" aria-label="Cerrar" onClick={() => setNoticeOpen(false)}>
            ×
          </button>
        </div>
      ) : null}
      {assistant && !inWorkspace && isEmptyAccount(doc) ? (
        <Onboarding connected={assistantConnected} onConnect={() => setAssistantOpen(true)} />
      ) : null}
      {inWorkspace && !inEditor ? (
      <header className="topbar">
        <div className="cv-anchor" ref={metadataRef}>
          <button
            type="button"
            className="cv-identity"
            aria-expanded={metadataOpen}
            onClick={() => setMetadataOpen((open) => !open)}
          >
            <span className="cv-title">{cv.title.trim() || 'Sin título'}</span>
            {cv.position.trim() || cv.company.trim() ? (
              <span className="cv-subtitle">
                {[cv.position.trim(), cv.company.trim()].filter(Boolean).join(' · ')}
              </span>
            ) : (
              <span className="cv-subtitle is-muted">Agregá puesto y aviso</span>
            )}
          </button>
          {metadataOpen ? (
            <CvMetadata
              cv={cv}
              sections={doc.sections}
              selectedVersionId={selectedVersionId}
              onMeta={updateCvMeta}
              onTemplate={updateTemplate}
              onToggleSection={toggleSection}
              onSelectVersion={setSelectedVersionId}
            />
          ) : null}
        </div>
        <div className="topbar-gap" />
        <div className="cv-editor-mode" role="group" aria-label="Modo">
          <button type="button" aria-pressed="false" onClick={() => setEditorMode('editor')}>
            Editor
          </button>
          <button type="button" className="is-current" aria-pressed="true">
            Grafo
          </button>
        </div>
        <details ref={viewsRef} className="views-anchor">
          <summary className="view-toggle views-trigger" aria-label="Vistas"><ViewsIcon /><span>Vistas</span></summary>
          <div className="view-toggles views-menu" role="toolbar" aria-label="Vistas disponibles">
          <div className="views-menu-title">Vistas disponibles</div>
          <button
            type="button"
            className={views.preview ? 'view-toggle is-open' : 'view-toggle'}
            aria-pressed={views.preview}
            aria-label="Vista previa"
            onClick={() => toggleView('preview')}
          >
            <PreviewIcon />
            <span>Vista previa</span>
          </button>
          <button
            type="button"
            className={views.style ? 'view-toggle is-open' : 'view-toggle'}
            aria-pressed={views.style}
            aria-label="Estilo"
            onClick={() => toggleView('style')}
          >
            <StyleIcon />
            <span>Estilo</span>
          </button>
          <button
            type="button"
            className={views.graph ? 'view-toggle is-open' : 'view-toggle'}
            aria-pressed={views.graph}
            aria-label="Grafo"
            onClick={() => toggleView('graph')}
          >
            <GraphIcon />
            <span>Grafo</span>
          </button>
          <button
            type="button"
            className={views.table ? 'view-toggle is-open' : 'view-toggle'}
            aria-pressed={views.table}
            aria-label="Tabla"
            onClick={() => toggleView('table')}
          >
            <TableIcon />
            <span>Tabla</span>
          </button>
          </div>
        </details>
        <div className="download-anchor" ref={downloadRef}>
          <button
            type="button"
            className="view-toggle"
            aria-label="Descargar"
            aria-expanded={downloadOpen}
            aria-haspopup="menu"
            data-tip={downloadOpen ? undefined : 'Descargar'}
            onClick={() => setDownloadOpen((open) => !open)}
          >
            <DownloadIcon />
          </button>
          {downloadOpen ? (
            <div className="download-menu" role="menu">
              <button type="button" role="menuitem" disabled={!exportSnapshot} onClick={() => { setDownloadOpen(false); downloadPdf(cv.pageSize, cv.title) }}>
                PDF
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!exportSnapshot}
                onClick={() => {
                  if (!exportSnapshot) return
                  setDownloadOpen(false)
                  downloadDoc(cv.title, exportSnapshot, cv.enabledSections, doc.sections, cv.sectionOrder)
                }}
              >
                DOC
              </button>
            </div>
          ) : null}
        </div>
        <button type="button" className="button primary build-button" aria-label="Generar" data-tip="Generar" onClick={build}>
          <BuildIcon />
        </button>
      </header>
      ) : null}
      {route.page === 'applications' ? (
        <Applications
          applications={doc.applications}
          statuses={doc.applicationStatuses}
          companies={doc.companies}
          cvs={doc.cvs}
          onChange={changeTracker}
          selectedId={routeApplication?.id ?? null}
          tab={route.tab ?? 'process'}
          onSelect={(id, tab) => {
            if (id && tab === 'cv') openApplicationCv(id)
            else navigate(id ? { page: 'applications', applicationId: id, tab: tab ?? 'process' } : { page: 'applications' })
          }}
          renderCv={applicationCvTab}
          assistant={assistantHint}
        />
      ) : route.page === 'profile' ? (
        <ProfilePage tab={route.tab} onTab={(tab) => navigate({ page: 'profile', tab })} counts={{ achievements: doc.bank.length }}>
          {route.tab === 'achievements' ? (
            <ExperienceMaster
              bank={doc.bank}
              answers={doc.knowledge}
              onAnswer={setKnowledge}
              onApplyAnswers={applyKnowledge}
              onBank={updateBank}
              places={sectionsView(doc).flatMap((section) =>
                section.entries.map((entry) => ({
                  id: entry.id,
                  label: `${section.name}: ${[entry.title, entry.subtitle].filter(Boolean).join(' — ') || 'Sin título'}`,
                })),
              )}
              onLink={(experienceId, entryId) => setDoc((current) => saveExperience(current, { id: experienceId, entryId }).document)}
              onDelete={(ids) => setDoc((current) => deleteExperiences(current, ids))}
            />
          ) : route.tab === 'sections' ? (
            <Library
              key={libraryKey}
              sections={doc.sections}
              roleGraphs={doc.roleGraphs}
              bank={doc.bank}
              jobs={doc.profile.jobs}
              onChange={changeSections}
              onChangeRoles={changeRoleGraphs}
              views={sectionsView(doc)}
            />
          ) : (
            <PersonalData profile={doc.profile} onProfile={updateProfile} />
          )}
        </ProfilePage>
      ) : !inWorkspace ? (
        <MyCvs
          doc={doc}
          onOpen={openCv}
          onOpenApplication={openApplicationCv}
          onCreate={createGeneralCv}
          onFromPosting={() => setWizard({ seed: null })}
          onCopy={(cvId) => setDoc((current) => copyCv(current, cvId).document)}
          onRename={(cvId, title) => setDoc((current) => ({ ...current, cvs: current.cvs.map((item) => (item.id === cvId ? { ...item, title } : item)) }))}
          onDelete={deleteCv}
          onMakeGeneral={(cvId) => setDoc((current) => assignCv(current, cvId, null))}
          assistant={assistantHint}
        />
      ) : inEditor && draft ? (
        <>
          <CvEditor
            doc={doc}
            cv={cv}
            draft={draft}
            setDoc={setDoc}
            saveStatus={saveStatus}
            onRetrySave={retrySave}
            selectedVersionId={selectedVersionId}
            onSelectVersion={setSelectedVersionId}
            onSaveVersion={saveVersion}
            onBack={() => navigate({ page: 'cvs' })}
            onGraph={() => {
              setSelectedVersionId(null)
              setEditorMode('graph')
            }}
            basedOnTitle={basedOnTitle}
            assistant={assistantHint}
          />
          {printSource}
        </>
      ) : (
      <>
      <main ref={workspaceRef} className={split ? `workspace is-split is-props-${layout.props}` : `workspace is-props-${layout.props}`}>
        {layout.props === 'top' ? stylePane : null}
        <div className="workspace-band">
          {layout.props === 'left' ? stylePane : null}
          <div className="workspace-main">
            {[...layout.main, 'table' as const].map((id, index) => {
              if (!views[id]) return null
              const earlier = [...layout.main, 'table' as const].slice(0, index).some((item) => views[item])
              return (
                <Fragment key={id}>
                  {earlier && split ? (
                    <div
                      className="view-sash"
                      role="separator"
                      tabIndex={0}
                      aria-orientation="vertical"
                      aria-label="Redimensionar vistas"
                      onPointerDown={onSashPointerDown}
                      onPointerMove={onSashPointerMove}
                    />
                  ) : null}
                  {id === 'preview' ? previewPane : id === 'graph' ? graphPane : tablePane}
                </Fragment>
              )
            })}
            {!views.preview && !views.style && !views.graph && !views.table ? <p className="workspace-empty">Abrí Vista previa, Estilo, Grafo o Tabla.</p> : null}
          </div>
          {layout.props === 'right' ? stylePane : null}
        </div>
        {layout.props === 'bottom' ? stylePane : null}
        {dragging === 'style' ? (
          <DockZones
            hot={dropEdge}
            onHot={setDropEdge}
            onDock={(edge) => {
              setLayout((current) => ({ ...current, props: edge }))
              endDrag()
            }}
          />
        ) : null}
      </main>
      {exportSnapshot ? (
        <div className="print-source" aria-hidden="true">
          <ResumePreview
            snapshot={exportSnapshot}
            templateId={cv.templateId}
            fontId={cv.fontId}
            fontSize={cv.fontSize}
            lineHeight={cv.lineHeight}
            marginId={cv.marginId}
            pageSize={cv.pageSize}
            skillsFormat={cv.skillsFormat ?? 'list'}
            accentColor={cv.accentColor}
            sectionOrder={cv.sectionOrder}
            enabledSections={cv.enabledSections}
            sections={doc.sections}
            blocks={snapshot?.blocks ?? []}
          />
        </div>
      ) : null}
      </>
      )}
      </div>
      {wizard ? (
        <NewCvWizard bank={doc.bank} knowledge={doc.knowledge} seed={wizard.seed} onClose={() => setWizard(null)} onCreate={createCv} />
      ) : null}
      {assistant && assistantOpen ? (
        <ConnectAssistant
          mcpUrl={assistant.mcpUrl}
          apps={connections.apps}
          onDisconnect={connections.disconnect}
          onClose={() => {
            setAssistantOpen(false)
            void connections.refresh()
          }}
        />
      ) : null}
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2.5v7M5.2 7.2 8 10l2.8-2.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12.5h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function PreviewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="1.5" width="11" height="13" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 5.5h6M5 8h6M5 10.5h3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function StyleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="6" cy="4.5" r="1.5" fill="currentColor" />
      <circle cx="10.5" cy="8" r="1.5" fill="currentColor" />
      <circle cx="7" cy="11.5" r="1.5" fill="currentColor" />
    </svg>
  )
}

function GraphIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="4" cy="4.5" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="3.5" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8.5" cy="12" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 5.2 7.4 10.5M10.6 4.6 9.2 10.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function TableIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 6h11M6 6.5v6.5M10 6.5v6.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function ViewsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="9" width="5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="9" width="5" height="4.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function BuildIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.2v9.6L12.5 8 5 3.2z" fill="currentColor" />
    </svg>
  )
}

const dockLabels: Record<DockEdge, string> = { left: 'Izquierda', right: 'Derecha', top: 'Arriba', bottom: 'Abajo' }

function DockZones({
  hot,
  onHot,
  onDock,
}: {
  hot: DockEdge | null
  onHot: (edge: DockEdge) => void
  onDock: (edge: DockEdge) => void
}) {
  const edges: DockEdge[] = ['left', 'right', 'top', 'bottom']
  return (
    <>
      {edges.map((edge) => (
        <div
          key={edge}
          className={hot === edge ? `dock-zone is-${edge} is-hot` : `dock-zone is-${edge}`}
          onDragOver={(event) => {
            event.preventDefault()
            onHot(edge)
          }}
          onDrop={(event) => {
            event.preventDefault()
            onDock(edge)
          }}
        >
          {dockLabels[edge]}
        </div>
      ))}
    </>
  )
}

function StylePane({
  bar,
  templateId,
  fontId,
  fontSize,
  lineHeight,
  marginId,
  pageSize,
  skillsFormat,
  onTemplate,
  onChange,
}: {
  bar: boolean
  templateId: TemplateId
  fontId: FontId
  fontSize: FontSize
  lineHeight: LineSpacing
  marginId: MarginId
  pageSize: PageSize
  skillsFormat: 'list' | 'comma'
  onTemplate: (templateId: TemplateId) => void
  onChange: (patch: Partial<Pick<Cv, 'fontId' | 'fontSize' | 'lineHeight' | 'marginId' | 'pageSize' | 'skillsFormat'>>) => void
}) {
  const family = fonts.find((font) => font.id === fontId)?.family
  return (
    <div className={bar ? 'style-pane is-bar' : 'style-pane'}>
      <label className="field">
        <span>Plantilla</span>
        <select
          aria-label="Plantilla"
          value={templateId}
          onChange={(event) => {
            const template = templates.find((item) => item.id === event.target.value)
            if (template) onTemplate(template.id)
          }}
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Fuente</span>
        <select
          aria-label="Fuente"
          value={fontId}
          style={{ fontFamily: family }}
          onChange={(event) => {
            if (isFontId(event.target.value)) onChange({ fontId: event.target.value })
          }}
        >
          {fonts.map((font) => (
            <option key={font.id} value={font.id} style={{ fontFamily: font.family }}>
              {font.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Tamaño</span>
        <select
          aria-label="Tamaño de fuente"
          value={fontSize}
          onChange={(event) => {
            const size = Number(event.target.value)
            if (isFontSize(size)) onChange({ fontSize: size })
          }}
        >
          {fontSizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Espaciado</span>
        <select
          aria-label="Interlineado"
          value={lineHeight}
          onChange={(event) => {
            const spacing = Number(event.target.value)
            if (isLineSpacing(spacing)) onChange({ lineHeight: spacing })
          }}
        >
          {lineSpacings.map((spacing) => (
            <option key={spacing} value={spacing}>
              {spacingLabel(spacing)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Márgenes</span>
        <select
          aria-label="Márgenes"
          value={marginId}
          onChange={(event) => {
            if (isMarginId(event.target.value)) onChange({ marginId: event.target.value })
          }}
        >
          {margins.map((margin) => (
            <option key={margin.id} value={margin.id}>
              {margin.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Papel</span>
        <select
          aria-label="Papel"
          value={pageSize}
          onChange={(event) => {
            if (isPageSize(event.target.value)) onChange({ pageSize: event.target.value })
          }}
        >
          {pageSizes.map((page) => (
            <option key={page.id} value={page.id}>
              {page.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Skills</span>
        <select aria-label="Formato de skills" value={skillsFormat} onChange={(event) => {
          if (event.target.value === 'list' || event.target.value === 'comma') onChange({ skillsFormat: event.target.value })
        }}>
          <option value="list">Lista de ítems</option>
          <option value="comma">Separadas por comas</option>
        </select>
      </label>
    </div>
  )
}

function CvMetadata({
  cv,
  sections,
  selectedVersionId,
  onMeta,
  onTemplate,
  onToggleSection,
  onSelectVersion,
}: {
  cv: Cv
  sections: CatalogSection[]
  selectedVersionId: string | null
  onMeta: (patch: Partial<Pick<Cv, 'title' | 'position' | 'company' | 'posting' | 'summary'>>) => void
  onTemplate: (templateId: TemplateId) => void
  onToggleSection: (id: string) => void
  onSelectVersion: (id: string) => void
}) {
  const latestId = cv.versions.at(-1)?.id ?? null
  const showingId = cv.versions.some((version) => version.id === selectedVersionId) ? selectedVersionId : latestId

  return (
    <div className="metadata metadata-wide">
      <p className="menu-label">Datos</p>
      <label className="field">
        <span>Nombre visible</span>
        <input value={cv.title} onChange={(event) => onMeta({ title: event.target.value })} />
      </label>
      <div className="metadata-grid">
        <label className="field">
          <span>Puesto</span>
          <input value={cv.position} placeholder="Software Engineer" onChange={(event) => onMeta({ position: event.target.value })} />
        </label>
        <label className="field">
          <span>Empresa</span>
          <input value={cv.company} placeholder="Acme" onChange={(event) => onMeta({ company: event.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>Aviso</span>
        <textarea
          className="metadata-posting"
          value={cv.posting}
          placeholder="Pegá el aviso al que apunta este CV…"
          onChange={(event) => onMeta({ posting: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Resumen</span>
        <textarea value={cv.summary} onChange={(event) => onMeta({ summary: event.target.value })} />
      </label>
      <p className="menu-label">Plantilla</p>
      <ul className="metadata-list">
        {templates.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              className={template.id === cv.templateId ? 'metadata-item is-current' : 'metadata-item'}
              onClick={() => onTemplate(template.id)}
            >
              <span className="metadata-template">
                <span>{template.name}</span>
                <span className="template-sections">{template.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="menu-label">Secciones</p>
      {sections.map((section) => {
        const name = section.name.trim() || 'Sección'
        return (
          <label key={section.id} className="section-toggle">
            <input
              type="checkbox"
              checked={cv.enabledSections.includes(section.id)}
              onChange={() => onToggleSection(section.id)}
            />
            <span>{name}</span>
          </label>
        )
      })}
      <p className="menu-label">Versiones</p>
      {cv.versions.length === 0 ? (
        <p className="metadata-empty">Generar guarda una versión de este CV a partir de tu experiencia.</p>
      ) : (
        <ul className="metadata-list">
          {[...cv.versions].reverse().map((version, reverseIndex) => {
            const number = cv.versions.length - reverseIndex
            const when = formatVersionDate(version.createdAt)
            return (
              <li key={version.id}>
                <button
                  type="button"
                  className={version.id === showingId ? 'metadata-item is-current' : 'metadata-item'}
                  onClick={() => onSelectVersion(version.id)}
                >
                  <span>Versión {number}</span>
                  {when ? <span className="metadata-when">{when}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function selectedBulletId(nodes: ResumeNode[], snapshot: Snapshot | null): string {
  if (!snapshot || snapshot.placeholder) return ''
  const selected = nodes.find((node) => node.selected && node.type === 'bullet')
  if (!selected) return ''
  const built = snapshot.roles.some((role) => role.bullets.some((bullet) => bullet.id === selected.id))
  return built ? selected.id : ''
}

function shownSnapshot(cv: Cv, selectedVersionId: string | null): Snapshot | null {
  if (cv.versions.length === 0) return null
  const selected = cv.versions.find((version) => version.id === selectedVersionId)
  return (selected ?? cv.versions[cv.versions.length - 1]).snapshot
}

function olderVersionNote(cv: Cv, selectedVersionId: string | null): string | null {
  if (cv.versions.length === 0) return null
  const index = cv.versions.findIndex((version) => version.id === selectedVersionId)
  if (index < 0 || index === cv.versions.length - 1) return null
  return `Versión ${index + 1}. Tu experiencia sigue en el grafo. Generar guarda una versión nueva.`
}

function formatVersionDate(iso: string) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('es-AR', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function deselect(node: ResumeNode): ResumeNode {
  return { ...node, selected: false }
}
