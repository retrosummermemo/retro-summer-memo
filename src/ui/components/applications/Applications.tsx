import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import {
  STALE_DAYS,
  countByStatus,
  defaultQuery,
  filterApplications,
  isStale,
  lastActivity,
  upcomingEvents,
  type ApplicationQuery,
  type ApplicationScope,
  type ApplicationSort,
} from '../../../domain/applicationFilters'
import {
  createApplication,
  moveApplication,
  updateApplication,
  type Application,
  type ApplicationStatus,
} from '../../../domain/applications'
import { companyOf, deleteCompany, deleteCompanyNote, saveCompany, saveCompanyNote, type Company } from '../../../domain/companies'
import { shownCvOfApplication } from '../../../domain/cvLibrary'
import type { Cv, ResumeDocument } from '../../../domain/model'
import { formatDateTime, formatDay, relativeTime, todayYmd } from '../../format'
import type { ApplicationTab } from '../../routes'
import { CompanyLogo } from '../companies/CompanyLogo'
import { ApplicationPage, type CompanyActions } from './ApplicationPage'
import { ApplicationForm, type ApplicationFormValues } from './ApplicationForm'
import { cvLabel } from './cvs'
import { StatusSelect } from './StatusPill'
import { StatusEditor } from './StatusEditor'
import { PromptHint } from '../assistant/PromptHint'
import { prompts } from '../assistant/prompts'

export type TrackerData = Pick<ResumeDocument, 'applications' | 'applicationStatuses' | 'companies'>

type ApplicationsProps = {
  applications: Application[]
  statuses: ApplicationStatus[]
  companies: Company[]
  cvs: Cv[]
  onChange: (update: (current: TrackerData) => TrackerData) => void
  /** The application open as a page (from the URL), and its tab. */
  selectedId: string | null
  tab: ApplicationTab
  onSelect: (id: string | null, tab?: ApplicationTab) => void
  /** The CV tab of an application: its CV in the editor, or how to make one. */
  renderCv: (application: Application) => ReactNode
  /** Assistants connected through the MCP: the requests to make to them are suggested. */
  assistant?: { connected: boolean; onConnect: () => void }
}

type ViewMode = 'list' | 'board'
type FormState = { mode: 'new' } | { mode: 'edit'; id: string } | null

const viewKey = 'resume.applicationsView.v1'
const queryKey = 'resume.applicationsQuery.v1'

const scopes: { id: ApplicationScope; label: string }[] = [
  { id: 'open', label: 'En curso' },
  { id: 'closed', label: 'Cerradas' },
  { id: 'all', label: 'Todas' },
]

const sorts: { id: ApplicationSort; label: string }[] = [
  { id: 'activity', label: 'Última actividad' },
  { id: 'applied', label: 'Fecha de postulación' },
  { id: 'company', label: 'Empresa' },
]

function loadView(): ViewMode {
  try {
    return localStorage.getItem(viewKey) === 'board' ? 'board' : 'list'
  } catch {
    return 'list'
  }
}

function loadQuery(): ApplicationQuery {
  try {
    const raw = sessionStorage.getItem(queryKey)
    if (raw) return { ...defaultQuery(), ...(JSON.parse(raw) as Partial<ApplicationQuery>) }
  } catch {
    /* ignore */
  }
  return defaultQuery()
}

export function Applications({ applications, statuses, companies, cvs, onChange, selectedId, tab, onSelect, renderCv, assistant }: ApplicationsProps) {
  const [query, setQuery] = useState<ApplicationQuery>(loadQuery)
  const [view, setView] = useState<ViewMode>(loadView)
  const [form, setForm] = useState<FormState>(null)
  const [editingStatuses, setEditingStatuses] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(viewKey, view)
    } catch {
      /* ignore */
    }
  }, [view])

  useEffect(() => {
    try {
      sessionStorage.setItem(queryKey, JSON.stringify(query))
    } catch {
      /* ignore */
    }
  }, [query])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || form || editingStatuses) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key === 'n') {
        event.preventDefault()
        setForm({ mode: 'new' })
      } else if (event.key === 'Escape' && tab !== 'cv') {
        onSelect(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [form, editingStatuses, tab, onSelect])

  const now = useNow()
  const statusById = useMemo(() => new Map(statuses.map((status) => [status.id, status])), [statuses])
  const visible = filterApplications(applications, statuses, query, now)
  const counts = countByStatus(applications, statuses, query, now)
  const staleCount = applications.filter((application) => isStale(application, statusById, STALE_DAYS, now)).length
  const selected = applications.find((application) => application.id === selectedId) ?? null
  const editing = form?.mode === 'edit' ? applications.find((application) => application.id === form.id) ?? null : null
  const filtered = query.text.trim() !== '' || query.statusIds.length > 0 || query.scope !== 'all' || query.staleDays !== null

  function patchQuery(change: Partial<ApplicationQuery>) {
    setQuery((current) => ({ ...current, ...change }))
  }

  function toggleStatus(id: string) {
    setQuery((current) => ({
      ...current,
      statusIds: current.statusIds.includes(id) ? current.statusIds.filter((item) => item !== id) : [...current.statusIds, id],
    }))
  }

  function replace(next: Application) {
    onChange((current) => ({
      ...current,
      applications: current.applications.map((application) => (application.id === next.id ? next : application)),
    }))
  }

  function move(id: string, statusId: string) {
    onChange((current) => ({
      ...current,
      applications: current.applications.map((application) =>
        application.id === id ? moveApplication(application, statusId, '', new Date(), { statuses: current.applicationStatuses, appliedOn: todayYmd() }) : application,
      ),
    }))
  }

  function remove(id: string) {
    onChange((current) => ({ ...current, applications: current.applications.filter((application) => application.id !== id) }))
    onSelect(null)
  }

  /**
   * Runs a company edit: first on what is on screen, to report a refusal (a rename onto another
   * company…) instead of throwing inside a state update; then on the latest state.
   */
  function companyEdit(edit: (current: TrackerData) => TrackerData): string | null {
    try {
      edit({ applications, applicationStatuses: statuses, companies })
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    onChange((current) => {
      try {
        return edit(current)
      } catch {
        return current
      }
    })
    return null
  }

  const companyActions: CompanyActions = {
    save: (input) => companyEdit((current) => saveCompany(current, input).document),
    saveNote: (company, input) => companyEdit((current) => saveCompanyNote(current, company, input).document),
    deleteNote: (companyId, noteId) => void companyEdit((current) => deleteCompanyNote(current, companyId, noteId)),
    delete: (companyId) => void companyEdit((current) => deleteCompany(current, companyId)),
  }

  function submitForm(values: ApplicationFormValues, options: { buildCv: boolean }) {
    if (editing) {
      replace(
        updateApplication(editing, {
          url: values.url.trim(),
          company: values.company.trim(),
          title: values.title.trim(),
          location: values.location.trim(),
          appliedOn: values.appliedOn,
          posting: values.posting,
          attachment: values.attachment,
        }),
      )
      setForm(null)
      return
    }
    const created = createApplication(values, statuses)
    onChange((current) => ({ ...current, applications: [created, ...current.applications] }))
    setForm(null)
    onSelect(created.id, options.buildCv ? 'cv' : 'process')
  }

  if (selected) {
    return (
      <div className={tab === 'cv' ? 'home tracker is-cv' : 'home tracker'}>
        <ApplicationPage
          key={selected.id}
          application={selected}
          applications={applications}
          statuses={statuses}
          companies={companies}
          cvs={cvs}
          now={now}
          onChange={replace}
          company={companyActions}
          onDelete={() => remove(selected.id)}
          onEdit={() => setForm({ mode: 'edit', id: selected.id })}
          onClose={() => onSelect(null)}
          onSelect={(id) => onSelect(id)}
          tab={tab}
          onTab={(next) => onSelect(selected.id, next)}
          cvTab={tab === 'cv' ? renderCv(selected) : null}
          assistant={assistant}
        />
        {form ? (
          <ApplicationForm
            initial={editing}
            applications={applications}
            statuses={statuses}
            cvs={cvs}
            onSubmit={submitForm}
            onCancel={() => setForm(null)}
            onOpen={(id) => {
              setForm(null)
              onSelect(id)
            }}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="home tracker">
      <div className="home-head">
        <h1>Postulaciones</h1>
        {applications.length > 0 ? <span className="tracker-total">{applications.length}</span> : null}
        <div className="segment" role="group" aria-label="Vista">
          <button type="button" className={view === 'list' ? 'is-current' : undefined} aria-pressed={view === 'list'} onClick={() => setView('list')}>
            Lista
          </button>
          <button type="button" className={view === 'board' ? 'is-current' : undefined} aria-pressed={view === 'board'} onClick={() => setView('board')}>
            Tablero
          </button>
        </div>
        <button type="button" className="button tracker-statuses-button" onClick={() => setEditingStatuses(true)}>
          Estados
        </button>
        <button type="button" className="button primary" aria-keyshortcuts="n" title="Nueva postulación (N)" onClick={() => setForm({ mode: 'new' })}>
          Nueva postulación
        </button>
      </div>

      {assistant ? <PromptHint prompt={prompts.buildCv} onConnect={assistant.connected ? undefined : assistant.onConnect} /> : null}

      {applications.length === 0 ? (
        <div className="tracker-empty">
          <h2>Todavía no cargaste postulaciones</h2>
          <p>
            Pedile a tu asistente “Armemos el CV para” y el link del aviso: chequea si ya te postulaste, carga la postulación y arma el CV.
            Después contale las novedades (“me llamaron de…”) y va moviendo cada postulación por tus estados. También podés cargarlas a mano.
          </p>
          <button type="button" className="button primary" onClick={() => setForm({ mode: 'new' })}>
            Cargar la primera
          </button>
        </div>
      ) : (
        <>
          <div className="tracker-filters">
            <input
              ref={searchRef}
              type="search"
              className="tracker-search"
              aria-label="Buscar postulaciones"
              placeholder="Buscar empresa, puesto, estado, notas…  (-palabra excluye · atajo /)"
              value={query.text}
              onChange={(event) => patchQuery({ text: event.target.value })}
            />
            <div className="segment" role="group" aria-label="Abiertas o cerradas">
              {scopes.map((scope) => (
                <button
                  key={scope.id}
                  type="button"
                  className={query.scope === scope.id ? 'is-current' : undefined}
                  aria-pressed={query.scope === scope.id}
                  onClick={() => patchQuery({ scope: scope.id })}
                >
                  {scope.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={query.staleDays !== null ? 'filter-chip is-on is-stale' : 'filter-chip'}
              aria-pressed={query.staleDays !== null}
              title={`Postulaciones abiertas sin ningún movimiento en ${STALE_DAYS} días o más`}
              onClick={() => patchQuery({ staleDays: query.staleDays === null ? STALE_DAYS : null })}
            >
              Sin novedades +{STALE_DAYS} días <span className="filter-count">{staleCount}</span>
            </button>
            <label className="tracker-sort">
              <span>Orden</span>
              <select value={query.sort} onChange={(event) => patchQuery({ sort: event.target.value as ApplicationSort })}>
                {sorts.map((sort) => (
                  <option key={sort.id} value={sort.id}>
                    {sort.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="tracker-status-filters" role="group" aria-label="Filtrar por estado">
            {statuses.map((status) => {
              const on = query.statusIds.includes(status.id)
              return (
                <button
                  key={status.id}
                  type="button"
                  className={on ? 'filter-chip is-on' : 'filter-chip'}
                  aria-pressed={on}
                  style={{ '--status': status.color } as CSSProperties}
                  onClick={() => toggleStatus(status.id)}
                >
                  <span className="status-dot" aria-hidden="true" />
                  {status.name} <span className="filter-count">{counts.get(status.id) ?? 0}</span>
                </button>
              )
            })}
            {filtered ? (
              <button type="button" className="link-button" onClick={() => setQuery({ ...defaultQuery(), sort: query.sort })}>
                Limpiar filtros
              </button>
            ) : null}
          </div>

          <div className="tracker-body">
            <div className="tracker-results">
              {visible.length === 0 ? (
                <p className="tracker-none">
                  Nada coincide con estos filtros.{' '}
                  <button type="button" className="link-button" onClick={() => setQuery({ ...defaultQuery(), sort: query.sort })}>
                    Limpiar filtros
                  </button>
                </p>
              ) : view === 'list' ? (
                <ApplicationList
                  applications={visible}
                  statuses={statuses}
                  statusById={statusById}
                  companies={companies}
                  cvs={cvs}
                  selectedId={selectedId}
                  now={now}
                  onSelect={(id) => onSelect(id)}
                  onMove={move}
                />
              ) : (
                <ApplicationBoard
                  applications={visible}
                  statuses={statuses.filter(
                    (status) =>
                      (query.statusIds.length === 0 || query.statusIds.includes(status.id)) &&
                      (query.scope === 'all' ||
                        (query.scope === 'open') === (status.kind !== 'rejected' && status.kind !== 'withdrawn')),
                  )}
                  statusById={statusById}
                  companies={companies}
                  selectedId={selectedId}
                  now={now}
                  onSelect={(id) => onSelect(id)}
                  onMove={move}
                />
              )}
            </div>
          </div>
        </>
      )}

      {form ? (
        <ApplicationForm
          initial={editing}
          applications={applications}
          statuses={statuses}
          cvs={cvs}
          onSubmit={submitForm}
          onCancel={() => setForm(null)}
          onOpen={(id) => {
            setForm(null)
            onSelect(id)
          }}
        />
      ) : null}

      {editingStatuses ? (
        <StatusEditor
          statuses={statuses}
          applications={applications}
          onChange={(nextStatuses, nextApplications) =>
            onChange((current) => ({ ...current, applicationStatuses: nextStatuses, applications: nextApplications }))
          }
          onClose={() => setEditingStatuses(false)}
        />
      ) : null}
    </div>
  )
}

/** Current time, refreshed every minute so "hace 3 días" and stale flags stay right. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

type ResultsProps = {
  applications: Application[]
  statusById: Map<string, ApplicationStatus>
  companies: Company[]
  selectedId: string | null
  now: Date
  onSelect: (id: string) => void
  onMove: (id: string, statusId: string) => void
}

function ActivityCell({ application, statusById, now }: { application: Application; statusById: Map<string, ApplicationStatus>; now: Date }) {
  const next = upcomingEvents(application, now)[0]
  if (next) {
    return (
      <span className="tracker-activity is-upcoming" title={next.text}>
        Próx.: {formatDateTime(next.at)}
      </span>
    )
  }
  const stale = isStale(application, statusById, STALE_DAYS, now)
  return (
    <span className={stale ? 'tracker-activity is-stale' : 'tracker-activity'} title={stale ? 'Sin novedades hace rato: ¿hacés seguimiento?' : undefined}>
      {relativeTime(lastActivity(application, now), now)}
    </span>
  )
}

function ApplicationList({
  applications,
  statuses,
  statusById,
  companies,
  cvs,
  selectedId,
  now,
  onSelect,
  onMove,
}: ResultsProps & { statuses: ApplicationStatus[]; cvs: Cv[] }) {
  return (
    <table className="tracker-table">
      <thead>
        <tr>
          <th scope="col">Empresa y puesto</th>
          <th scope="col">Estado</th>
          <th scope="col">Postulado</th>
          <th scope="col">Último movimiento</th>
          <th scope="col">CV</th>
        </tr>
      </thead>
      <tbody>
        {applications.map((application) => {
          const on = application.appliedOn || application.createdAt
          // A posting still being weighed has not been applied to yet.
          const notYet = !application.appliedOn && statusById.get(application.statusId)?.kind === 'considering'
          const cv = shownCvOfApplication({ cvs }, application)
          return (
            <tr
              key={application.id}
              className={application.id === selectedId ? 'is-selected' : undefined}
              onClick={() => onSelect(application.id)}
            >
              <td>
                <button type="button" className="tracker-row-main" onClick={() => onSelect(application.id)}>
                  <CompanyLogo name={application.company} company={companyOf(companies, application)} size={32} />
                  <span className="tracker-row-text">
                    <strong>{application.company || 'Sin empresa'}</strong>
                    <span>{application.title || 'Sin puesto'}</span>
                  </span>
                </button>
              </td>
              <td>
                <StatusSelect
                  statuses={statuses}
                  value={application.statusId}
                  label={`Estado de ${application.company}`}
                  onChange={(statusId) => onMove(application.id, statusId)}
                />
              </td>
              {notYet ? (
                <td className="muted" title="Todavía no te postulaste">
                  —
                </td>
              ) : (
                <td title={formatDay(on)}>{formatDay(on)}</td>
              )}
              <td>
                <ActivityCell application={application} statusById={statusById} now={now} />
              </td>
              <td className="tracker-cv-cell">
                {cv ? (
                  <span title={cvLabel(cv)}>{cv.title || 'Sin título'}</span>
                ) : application.attachment?.kind === 'file' ? (
                  <span title={application.attachment.name}>{application.attachment.name}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ApplicationBoard({ applications, statuses, statusById, companies, selectedId, now, onSelect, onMove }: ResultsProps & { statuses: ApplicationStatus[] }) {
  const [over, setOver] = useState<string | null>(null)
  const byStatus = new Map<string, Application[]>(statuses.map((status) => [status.id, []]))
  for (const application of applications) byStatus.get(application.statusId)?.push(application)

  function drop(event: DragEvent, statusId: string) {
    event.preventDefault()
    setOver(null)
    const id = event.dataTransfer.getData('text/x-application')
    if (id) onMove(id, statusId)
  }

  return (
    <div className="tracker-board">
      {statuses.map((status) => (
        <section
          key={status.id}
          className={over === status.id ? 'tracker-column is-over' : 'tracker-column'}
          style={{ '--status': status.color } as CSSProperties}
          aria-label={status.name}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('text/x-application')) return
            event.preventDefault()
            setOver(status.id)
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null)
          }}
          onDrop={(event) => drop(event, status.id)}
        >
          <h3>
            <span className="status-dot" aria-hidden="true" />
            {status.name}
            <span className="filter-count">{byStatus.get(status.id)?.length ?? 0}</span>
          </h3>
          {(byStatus.get(status.id) ?? []).map((application) => (
            <button
              key={application.id}
              type="button"
              draggable
              className={application.id === selectedId ? 'tracker-card is-selected' : 'tracker-card'}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/x-application', application.id)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onClick={() => onSelect(application.id)}
            >
              <span className="tracker-card-company">
                <CompanyLogo name={application.company} company={companyOf(companies, application)} size={20} />
                <strong>{application.company || 'Sin empresa'}</strong>
              </span>
              <span>{application.title || 'Sin puesto'}</span>
              <ActivityCell application={application} statusById={statusById} now={now} />
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}
