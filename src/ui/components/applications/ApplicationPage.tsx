import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { upcomingEvents } from '../../../domain/applicationFilters'
import {
  companyKey,
  findDuplicates,
  moveApplication,
  removeApplicationNote,
  updateApplication,
  type Application,
  type ApplicationStatus,
} from '../../../domain/applications'
import { applicationsTo, companyOf, websiteHost, type Company, type CompanyInput, type CompanyNoteInput } from '../../../domain/companies'
import { cvOfApplication } from '../../../domain/cvLibrary'
import type { Cv } from '../../../domain/model'
import { formatDateTime, formatDay, relativeTime, todayYmd } from '../../format'
import type { ApplicationTab } from '../../routes'
import { CompanyLogo } from '../companies/CompanyLogo'
import { CompanyPanel } from '../companies/CompanyPanel'
import { ExtraFields } from '../ExtraFields'
import { versionLabel } from './cvs'
import { DuplicateAlert } from './DuplicateAlert'
import { eventKindLabel } from './eventKinds'
import { StageTimeline } from './StageTimeline'
import { StatusSelect } from './StatusPill'

export type CompanyActions = {
  /** Each returns an error message, or null when it was saved. */
  save: (input: CompanyInput) => string | null
  saveNote: (company: string, input: CompanyNoteInput) => string | null
  deleteNote: (companyId: string, noteId: string) => void
  delete: (companyId: string) => void
}

type ApplicationPageProps = {
  application: Application
  applications: Application[]
  statuses: ApplicationStatus[]
  companies: Company[]
  cvs: Cv[]
  now: Date
  onChange: (next: Application) => void
  company: CompanyActions
  onDelete: () => void
  onEdit: () => void
  onClose: () => void
  onSelect: (applicationId: string) => void
  tab: ApplicationTab
  onTab: (tab: ApplicationTab) => void
  /** What the CV tab shows: the editor with this application's CV, or how to make one. */
  cvTab: ReactNode
  assistant?: { connected: boolean; onConnect: () => void }
}

const tabs: { id: ApplicationTab; label: string }[] = [
  { id: 'process', label: 'Proceso' },
  { id: 'cv', label: 'CV' },
  { id: 'company', label: 'Empresa' },
]

/**
 * One application as a page, in three tabs: the process step by step (how each step went, what is
 * scheduled, what comes next), its CV in the editor, and everything known about the company.
 */
export function ApplicationPage({
  application,
  applications,
  statuses,
  companies,
  cvs,
  now,
  onChange,
  company: companyActions,
  onDelete,
  onEdit,
  onClose,
  onSelect,
  tab,
  onTab,
  cvTab,
  assistant,
}: ApplicationPageProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const page = useRef<HTMLDivElement>(null)
  // Applications to this same company are listed in the company panel; this catches the rest
  // (the same posting saved under another company name).
  const related = useMemo(
    () => findDuplicates(applications, application, application.id).filter((match) => companyKey(match.application.company) !== companyKey(application.company)),
    [applications, application],
  )
  const company = companyOf(companies, application)
  const toCompany = applicationsTo(applications, application.company)

  // Opening another application (e.g. from the company panel) or tab starts at the top of the page.
  useEffect(() => {
    page.current?.closest('.home')?.scrollTo({ top: 0 })
  }, [application.id, tab])

  const ownCv = cvOfApplication({ cvs }, application.id)
  const attachment = application.attachment
  const sentCv = attachment?.kind === 'cv' ? cvs.find((cv) => cv.id === attachment.cvId) : undefined
  const sentVersion = sentCv && attachment?.kind === 'cv' ? sentCv.versions.find((version) => version.id === attachment.versionId) : undefined
  const basedOn = ownCv?.basedOn ? cvs.find((cv) => cv.id === ownCv.basedOn) : undefined
  const appliedOn = application.appliedOn || application.createdAt
  const notYet = !application.appliedOn && statuses.find((status) => status.id === application.statusId)?.kind === 'considering'
  const upcoming = upcomingEvents(application, now)
  const companyName = application.company || 'Sin empresa'

  return (
    <div className={`app-page is-tab-${tab}`} ref={page}>
      <div className="app-page-top">
      <button type="button" className="link-button app-page-back" onClick={onClose}>
        ← Postulaciones
      </button>

      <header className="app-page-head">
        <CompanyLogo name={company?.name || companyName} company={company} size={tab === 'cv' ? 44 : 64} />
        <div className="app-page-titles">
          <h1>{companyName}</h1>
          <p className="app-page-role">{application.title || 'Sin puesto'}</p>
          <p className="app-page-meta">
            <span>
              {notYet ? 'Guardado' : 'Postulado'} el {formatDay(appliedOn)} ({relativeTime(appliedOn, now)}){notYet ? ' · todavía no te postulaste' : ''}
            </span>
            {application.location ? <span>{application.location}</span> : null}
            {application.url ? (
              <a href={application.url} target="_blank" rel="noreferrer">
                Ver aviso ↗
              </a>
            ) : null}
          </p>
        </div>
        <div className="app-page-actions">
          <StatusSelect
            statuses={statuses}
            value={application.statusId}
            label={`Estado de ${companyName}`}
            onChange={(statusId) => onChange(moveApplication(application, statusId, '', new Date(), { statuses, appliedOn: todayYmd() }))}
          />
          <button type="button" className="button" onClick={onEdit}>
            Editar datos
          </button>
        </div>
      </header>

      <div className="page-tabs app-page-tabs" role="tablist" aria-label={`Postulación a ${companyName}`}>
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" className="page-tab" aria-selected={item.id === tab} onClick={() => onTab(item.id)}>
            {item.label}
            {item.id === 'cv' ? <span className={ownCv ? 'page-tab-badge' : 'page-tab-badge is-empty'}>{ownCv ? ownCv.title : 'Sin CV'}</span> : null}
            {item.id === 'company' && company?.notes.length ? <span className="page-tab-badge">{company.notes.length}</span> : null}
          </button>
        ))}
      </div>
      </div>

      {tab === 'cv' ? (
        <div className="app-page-cv">{cvTab}</div>
      ) : tab === 'company' ? (
        <div className="app-page-company">
          <CompanyPanel
            name={companyName}
            company={company}
            applications={toCompany}
            currentApplicationId={application.id}
            statuses={statuses}
            onSave={companyActions.save}
            onSaveNote={(input) => companyActions.saveNote(company?.id ?? companyName, input)}
            onDeleteNote={(noteId) => company && companyActions.deleteNote(company.id, noteId)}
            onDelete={() => company && companyActions.delete(company.id)}
            onOpenApplication={onSelect}
            assistant={assistant}
          />
        </div>
      ) : (
      <div className="app-page-grid">
        <div className="app-page-main">
          {upcoming.length > 0 ? (
            <section className="page-card">
              <h2>Agendado</h2>
              <ul className="tracker-upcoming">
                {upcoming.map((event) => (
                  <li key={event.id}>
                    <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                    <span>
                      {event.kind !== 'note' ? <strong>{eventKindLabel(event.kind)}</strong> : null} {event.text}
                    </span>
                    <button
                      type="button"
                      className="view-close"
                      aria-label="Quitar"
                      title="Quitar"
                      onClick={() => onChange(removeApplicationNote(application, event.id))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="page-card">
            <h2>Cómo viene el proceso</h2>
            <StageTimeline key={application.id} application={application} statuses={statuses} now={now} onChange={onChange} assistant={assistant} />
          </section>

          {related.length > 0 ? <DuplicateAlert matches={related} statuses={statuses} onOpen={onSelect} related /> : null}

          {application.posting.trim() ? (
            <details className="page-card tracker-posting">
              <summary>Aviso</summary>
              <div>{application.posting}</div>
            </details>
          ) : null}

          <div className="app-page-foot">
            {confirmDelete ? (
              <span className="confirm-inline">
                ¿Eliminar esta postulación?
                <button type="button" className="button danger" onClick={onDelete}>
                  Eliminar
                </button>
                <button type="button" className="button" onClick={() => setConfirmDelete(false)}>
                  No
                </button>
              </span>
            ) : (
              <button type="button" className="button" onClick={() => setConfirmDelete(true)}>
                Eliminar postulación
              </button>
            )}
          </div>
        </div>

        <aside className="app-page-side">
          <section className="page-card app-side-card">
            <h2>CV</h2>
            {ownCv ? (
              <>
                <p className="app-side-title">{ownCv.title}</p>
                <p className="app-side-detail">{basedOn ? `Partió de ${basedOn.title}` : 'Armado para esta postulación'}</p>
                <p className="app-side-detail">
                  {sentCv?.id === ownCv.id && sentVersion
                    ? `Mandaste la ${versionLabel(ownCv, sentVersion).toLowerCase()}`
                    : ownCv.versions.length > 0
                      ? `${ownCv.versions.length} ${ownCv.versions.length === 1 ? 'versión guardada' : 'versiones guardadas'}`
                      : 'Sin versiones guardadas todavía'}
                </p>
                <button type="button" className="button primary" onClick={() => onTab('cv')}>
                  Abrir el CV
                </button>
              </>
            ) : (
              <>
                {sentCv ? <p className="app-side-detail">Mandaste {sentCv.title}{sentVersion ? ` (${versionLabel(sentCv, sentVersion).toLowerCase()})` : ''}.</p> : null}
                <p className="app-side-detail">Esta postulación todavía no tiene su propio CV.</p>
                <button type="button" className="button primary" onClick={() => onTab('cv')}>
                  Armar el CV
                </button>
              </>
            )}
          </section>

          <section className="page-card app-side-card">
            <h2>Empresa</h2>
            <div className="app-side-company">
              <CompanyLogo name={company?.name || companyName} company={company} size={36} />
              <span>
                <strong>{company?.name || companyName}</strong>
                {company?.website ? <small>{websiteHost(company.website)}</small> : null}
              </span>
            </div>
            {company?.about ? <p className="app-side-about">{company.about}</p> : <p className="app-side-detail">Todavía no guardaste nada de esta empresa.</p>}
            <button type="button" className="button" onClick={() => onTab('company')}>
              {company && company.notes.length > 0 ? `Ver la empresa · ${company.notes.length} ${company.notes.length === 1 ? 'nota' : 'notas'}` : 'Ver la empresa'}
            </button>
          </section>

          <section className="page-card">
            <h2>Más datos del puesto</h2>
            <ExtraFields
              key={application.id}
              value={application.extra}
              empty="Sueldo, recruiter, modalidad, contacto… lo que quieras guardar de esta postulación."
              onChange={(extra) => onChange(updateApplication(application, { extra }))}
            />
          </section>
        </aside>
      </div>
      )}
    </div>
  )
}
