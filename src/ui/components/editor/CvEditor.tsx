import './editor.css'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type Dispatch, type SetStateAction } from 'react'
import { analyzeCv } from '../../../domain/cvAnalysis'
import { cvOutline, type CvGraph } from '../../../domain/cvEditing'
import type { Application } from '../../../domain/applications'
import type { Cv, ResumeDocument, Snapshot } from '../../../domain/model'
import { downloadDoc, downloadPdf } from '../../download'
import type { SaveStatus } from '../../useDocumentSync'
import { ResumePreview } from '../ResumePreview'
import type { EditorApi, PanelId, Review } from './editorApi'
import {
  AnalysisIcon,
  ArrowLeftIcon,
  ContentIcon,
  DesignIcon,
  DownloadIcon,
  FitIcon,
  GraphIcon,
  MinusIcon,
  PlusIcon,
  PostingIcon,
  SectionsIcon,
  VersionsIcon,
} from './icons'
import { AnalysisPanel } from './panels/AnalysisPanel'
import { ContentPanel } from './panels/ContentPanel'
import { DesignPanel } from './panels/DesignPanel'
import { PostingPanel } from './panels/PostingPanel'
import { SectionsPanel } from './panels/SectionsPanel'
import { VersionsPanel } from './panels/VersionsPanel'
import { ScoreRing } from './ScoreRing'

const panels: { id: PanelId; label: string; title: string; detail: string; Icon: ComponentType<{ size?: number }> }[] = [
  { id: 'content', label: 'Contenido', title: 'Contenido', detail: 'Lo que dice tu CV. Tocá cualquier parte de la hoja para editarla.', Icon: ContentIcon },
  { id: 'sections', label: 'Secciones', title: 'Secciones', detail: 'Qué secciones muestra este CV y en qué orden.', Icon: SectionsIcon },
  { id: 'design', label: 'Diseño', title: 'Diseño', detail: 'Plantilla, color, tipografía y espacios.', Icon: DesignIcon },
  { id: 'analysis', label: 'Análisis', title: 'Análisis', detail: 'Cómo lo leen un filtro automático y una persona de RRHH.', Icon: AnalysisIcon },
  { id: 'posting', label: 'Aviso', title: 'Aviso', detail: 'El puesto al que apunta este CV.', Icon: PostingIcon },
  { id: 'versions', label: 'Versiones', title: 'Versiones', detail: 'Copias fijas de lo que mandaste.', Icon: VersionsIcon },
]

const panelKey = 'resume.editorPanel.v1'
const zoomSteps = [0.5, 0.62, 0.75, 0.88, 1, 1.12, 1.25, 1.5]

function loadPanel(): PanelId {
  try {
    const saved = localStorage.getItem(panelKey)
    return panels.some((panel) => panel.id === saved) ? (saved as PanelId) : 'content'
  } catch {
    return 'content'
  }
}

/** JSON with sorted keys: equal content, equal text (stored snapshots come back with keys reordered). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
      : item,
  )
}

type CvEditorProps = {
  doc: ResumeDocument
  cv: Cv
  /** The CV as it prints now, built from its content. */
  draft: Snapshot
  setDoc: Dispatch<SetStateAction<ResumeDocument>>
  saveStatus: SaveStatus
  onRetrySave: () => void
  selectedVersionId: string | null
  onSelectVersion: (id: string | null) => void
  onSaveVersion: () => void
  /** Back to the CV list; none when the editor sits inside another page (an application). */
  onBack?: () => void
  onGraph: () => void
  /** The application this CV was made for: its versions can be marked as the one sent there. */
  application?: Application
  onMarkSent?: (versionId: string) => void
  /** The CV it was copied from. */
  basedOnTitle?: string
  assistant?: { connected: boolean; onConnect: () => void }
}

/**
 * The CV editor: the CV live on a canvas, and beside it panels for its content, sections, design,
 * analysis, target posting and versions. Clicking any part of the page opens it for editing.
 */
export function CvEditor({
  doc,
  cv,
  draft,
  setDoc,
  saveStatus,
  onRetrySave,
  selectedVersionId,
  onSelectVersion,
  onSaveVersion,
  onBack,
  onGraph,
  application,
  onMarkSent,
  basedOnTitle,
  assistant,
}: CvEditorProps) {
  const [panel, setPanelId] = useState<PanelId>(loadPanel)
  const [panelOpen, setPanelOpen] = useState(true)
  const [focusRef, setFocusRef] = useState<string | null>(null)
  const [revealToken, setRevealToken] = useState(0)
  const [zoom, setZoom] = useState<number | null>(null)
  const [fitScale, setFitScale] = useState(1)
  const [draftPages, setDraftPages] = useState(1)
  const [shownPages, setShownPages] = useState(1)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const downloadRef = useRef<HTMLDivElement>(null)

  const version = cv.versions.find((item) => item.id === selectedVersionId)
  const versionNumber = version ? cv.versions.indexOf(version) + 1 : 0
  const shown = version?.snapshot ?? draft
  const outline = useMemo(() => cvOutline({ nodes: doc.nodes, edges: doc.edges }), [doc.nodes, doc.edges])
  const analysis = useMemo(() => analyzeCv(cv, draft, doc.bank, { pages: draftPages }), [cv, draft, doc.bank, draftPages])
  const latest = cv.versions.at(-1)
  const dirty = !latest || canonical(latest.snapshot) !== canonical(draft)
  const issues = analysis.checks.filter((check) => check.status !== 'pass').length

  useEffect(() => {
    try {
      localStorage.setItem(panelKey, panel)
    } catch {
      /* ignore */
    }
  }, [panel])

  const setPanel = useCallback((id: PanelId) => {
    setPanelId(id)
    setPanelOpen(true)
  }, [])

  const focus = useCallback((ref: string | null, options: { reveal?: boolean } = {}) => {
    setFocusRef(ref)
    if (!options.reveal || !ref) return
    setPanel('content')
    setRevealToken((token) => token + 1)
  }, [setPanel])

  // What is being edited shows on the page: scroll it into view when it is off screen.
  useEffect(() => {
    if (!focusRef) return
    const target = canvasRef.current?.querySelector<HTMLElement>(`.is-sheet [data-ref="${CSS.escape(focusRef)}"]`)
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusRef, shown])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!version) onSaveVersion()
      } else if (event.key === 'Escape') {
        setDownloadOpen(false)
        const typing = (event.target as HTMLElement | null)?.closest('input, textarea, select')
        if (!typing) setFocusRef(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSaveVersion, version])

  useEffect(() => {
    if (!downloadOpen) return
    function onPointer(event: PointerEvent) {
      if (!downloadRef.current?.contains(event.target as Node)) setDownloadOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [downloadOpen])

  const onPages = useCallback(
    (count: number) => {
      setShownPages(count)
      if (!version) setDraftPages(count)
    },
    [version],
  )

  const api: EditorApi = {
    doc,
    cv,
    outline,
    draft,
    analysis,
    focusRef,
    focus,
    openPanel: setPanel,
    setDoc,
    setGraph: (update: (graph: CvGraph) => CvGraph) =>
      setDoc((current) => {
        const next = update({ nodes: current.nodes, edges: current.edges })
        return next.nodes === current.nodes && next.edges === current.edges ? current : { ...current, nodes: next.nodes, edges: next.edges }
      }),
    patchCv: (patch) => setDoc((current) => ({ ...current, cvs: current.cvs.map((item) => (item.id === current.activeCvId ? { ...item, ...patch } : item)) })),
    saveVersion: onSaveVersion,
    review,
    startReview: (title, refs) => {
      if (refs.length === 0) return
      setReview({ title, refs, index: 0 })
      focus(refs[0], { reveal: true })
    },
    stepReview: (delta) => {
      if (!review) return
      const index = (review.index + delta + review.refs.length) % review.refs.length
      setReview({ ...review, index })
      focus(review.refs[index], { reveal: true })
    },
    endReview: () => setReview(null),
    selectedVersionId: version ? version.id : null,
    selectVersion: onSelectVersion,
    application,
    markSent: onMarkSent,
    assistant,
  }

  const active = panels.find((item) => item.id === panel) ?? panels[0]
  const scale = zoom ?? fitScale
  const stepZoom = (direction: 1 | -1) => {
    const next = direction > 0 ? zoomSteps.find((step) => step > scale + 0.001) : [...zoomSteps].reverse().find((step) => step < scale - 0.001)
    if (next) setZoom(next)
  }

  return (
    <div className={onBack ? 'cv-editor' : 'cv-editor is-embedded'}>
      <header className="cv-editor-top">
        {onBack ? (
          <button type="button" className="cv-editor-back" onClick={onBack} title="Volver a tus CVs">
            <ArrowLeftIcon size={18} />
            <span>CVs</span>
          </button>
        ) : null}
        <div className="cv-editor-identity">
          <input
            className="cv-editor-name"
            aria-label="Nombre del CV"
            value={cv.title}
            placeholder="Sin título"
            onChange={(event) => api.patchCv({ title: event.target.value })}
          />
          <span className="cv-editor-subline">
            <button type="button" className="cv-editor-target" onClick={() => setPanel('posting')}>
              {[cv.position.trim(), cv.company.trim()].filter(Boolean).join(' · ') || 'Elegí el puesto al que apunta'}
            </button>
            {basedOnTitle ? (
              <span className="cv-editor-based" title="Es una copia: cambiar el original no la toca">
                Copia de {basedOnTitle}
              </span>
            ) : null}
          </span>
        </div>
        <SaveIndicator status={saveStatus} onRetry={onRetrySave} />
        <button type="button" className="cv-editor-score" onClick={() => setPanel('analysis')} title="Ver el análisis">
          <ScoreRing score={analysis.score} tone={analysis.grade.tone} size={34} stroke={3.5} />
          <span>
            <strong>{analysis.grade.label}</strong>
            <small>{issues === 0 ? 'Todo en orden' : `${issues} para mejorar`}</small>
          </span>
        </button>
        <div className="cv-editor-mode" role="group" aria-label="Modo">
          <button type="button" className="is-current" aria-pressed="true">
            Editor
          </button>
          <button type="button" aria-pressed="false" onClick={onGraph} title="El CV como grafo: para conectar experiencias a mano">
            <GraphIcon size={16} /> Grafo
          </button>
        </div>
        <div className="cv-editor-download" ref={downloadRef}>
          <button type="button" className="button" aria-haspopup="menu" aria-expanded={downloadOpen} onClick={() => setDownloadOpen((open) => !open)}>
            <DownloadIcon size={16} /> Descargar
          </button>
          {downloadOpen ? (
            <div className="cv-editor-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDownloadOpen(false)
                  downloadPdf(cv.pageSize, cv.title)
                }}
              >
                <strong>PDF</strong>
                <span>Para mandar: se ve igual en todos lados</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDownloadOpen(false)
                  downloadDoc(cv.title, shown, cv.enabledSections, doc.sections, cv.sectionOrder)
                }}
              >
                <strong>Word</strong>
                <span>Para cuando te lo piden editable</span>
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="button primary cv-editor-save"
          disabled={Boolean(version) || !dirty}
          onClick={onSaveVersion}
          title={dirty ? 'Guarda una copia fija de este CV (⌘S)' : 'No hay cambios desde la última versión'}
        >
          {dirty ? 'Guardar versión' : 'Versión al día'}
        </button>
      </header>

      <div className="cv-editor-body">
        <nav className="cv-editor-rail" aria-label="Paneles del editor">
          {panels.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={id === panel && panelOpen ? 'is-active' : undefined}
              aria-pressed={id === panel && panelOpen}
              title={id === panel && panelOpen ? 'Ocultar panel' : undefined}
              onClick={() => {
                if (id === panel) {
                  setPanelOpen((open) => !open)
                  return
                }
                // What was being edited stays marked only while editing content.
                if (id !== 'content') {
                  setFocusRef(null)
                  setReview(null)
                }
                setPanel(id)
              }}
            >
              <span className="cv-editor-rail-icon">
                <Icon size={21} />
                {id === 'analysis' && issues > 0 ? <span className={`cv-editor-rail-badge is-${analysis.grade.tone}`}>{issues}</span> : null}
                {id === 'posting' && !cv.posting.trim() ? <span className="cv-editor-rail-dot" /> : null}
                {id === 'versions' && cv.versions.length > 0 ? <span className="cv-editor-rail-count">{cv.versions.length}</span> : null}
              </span>
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {panelOpen ? (
        <aside className="cv-editor-panel" aria-label={active.title}>
          <div className="cv-editor-panel-head">
            <h2>{active.title}</h2>
            <p>{active.detail}</p>
          </div>
          <div className="cv-editor-panel-body" key={panel}>
            {panel === 'content' ? <ContentPanel api={api} revealToken={revealToken} /> : null}
            {panel === 'sections' ? <SectionsPanel api={api} /> : null}
            {panel === 'design' ? <DesignPanel api={api} /> : null}
            {panel === 'analysis' ? <AnalysisPanel api={api} /> : null}
            {panel === 'posting' ? <PostingPanel api={api} /> : null}
            {panel === 'versions' ? <VersionsPanel api={api} dirty={dirty} /> : null}
          </div>
        </aside>
        ) : null}

        <section className="cv-canvas" ref={canvasRef} aria-label="Vista del CV">
          {version ? (
            <div className="cv-canvas-banner" role="status">
              <span>
                Estás viendo la <strong>versión {versionNumber}</strong>, una copia fija. Los cambios van al borrador.
              </span>
              <button type="button" className="button" onClick={() => onSelectVersion(null)}>
                Volver al borrador
              </button>
            </div>
          ) : null}
          <div className={version ? 'cv-canvas-scroll' : 'cv-canvas-scroll is-editable'} onClick={(event) => event.target === event.currentTarget && setFocusRef(null)}>
            <ResumePreview
              snapshot={shown}
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
              blocks={shown.blocks ?? []}
              scale={zoom ?? undefined}
              onScale={setFitScale}
              onPages={onPages}
              onPick={version ? undefined : (ref) => focus(ref, { reveal: true })}
            />
          </div>
          <div className="cv-canvas-tools" role="toolbar" aria-label="Zoom">
            <button type="button" aria-label="Alejar" onClick={() => stepZoom(-1)}>
              <MinusIcon size={16} />
            </button>
            <span className="cv-canvas-zoom">{Math.round(scale * 100)}%</span>
            <button type="button" aria-label="Acercar" onClick={() => stepZoom(1)}>
              <PlusIcon size={16} />
            </button>
            <button type="button" className={zoom === null ? 'is-on' : undefined} aria-pressed={zoom === null} onClick={() => setZoom(null)} title="Ajustar al ancho">
              <FitIcon size={16} />
            </button>
            <span className="cv-canvas-pages">
              {shownPages} {shownPages === 1 ? 'página' : 'páginas'}
            </span>
          </div>
          {focusRef && !version ? <style>{`.cv-canvas .is-sheet [data-ref="${CSS.escape(focusRef)}"]{outline:2px solid #3b82f6!important;outline-offset:3px;border-radius:2px;background:rgba(59,130,246,.07)!important}`}</style> : null}
        </section>
      </div>
    </div>
  )
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status.state === 'error') {
    return (
      <button type="button" className="cv-editor-saved is-error" onClick={onRetry} title={status.message}>
        No se guardó · Reintentar
      </button>
    )
  }
  return (
    <span className={status.state === 'saving' ? 'cv-editor-saved is-saving' : 'cv-editor-saved'} role="status">
      <span className="cv-editor-saved-dot" aria-hidden="true" />
      {status.state === 'saving' ? 'Guardando…' : 'Guardado'}
    </span>
  )
}
