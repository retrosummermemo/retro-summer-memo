import './cvs.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { analyzeCv, type CvAnalysis } from '../../../domain/cvAnalysis'
import { applicationCvs, copiesByCv, generalCvs } from '../../../domain/cvLibrary'
import { rememberGraph } from '../../../domain/documentOps'
import { companyOf } from '../../../domain/companies'
import { buildResume, type Cv, type ResumeDocument, type Snapshot } from '../../../domain/model'
import { formatDay, relativeTime } from '../../format'
import { PromptHint } from '../assistant/PromptHint'
import { StatusPill } from '../applications/StatusPill'
import { CompanyLogo } from '../companies/CompanyLogo'
import { ScoreRing } from '../editor/ScoreRing'
import { CvPaper } from './CvPaper'

export type NewCvStart = { kind: 'profile' } | { kind: 'copy'; cvId: string } | { kind: 'structure' }
export type NewCvInput = { title: string; position: string; start: NewCvStart }

type MyCvsProps = {
  doc: ResumeDocument
  onOpen: (cvId: string) => void
  onOpenApplication: (applicationId: string) => void
  onCreate: (input: NewCvInput) => void
  onFromPosting: () => void
  onCopy: (cvId: string) => void
  onRename: (cvId: string, title: string) => void
  onDelete: (cvId: string) => void
  /** Turns an application's CV into a general one (it leaves the application). */
  onMakeGeneral: (cvId: string) => void
  assistant?: { connected: boolean; onConnect: () => void }
}

type Drafts = Map<string, { snapshot: Snapshot; analysis: CvAnalysis }>

/**
 * "Mis CVs": the general CVs (one per role or profile: CV React, CV Arquitecto…), each a starting
 * point, and below the CVs made for each application.
 */
export function MyCvs({ doc, onOpen, onOpenApplication, onCreate, onFromPosting, onCopy, onRename, onDelete, onMakeGeneral, assistant }: MyCvsProps) {
  const [creating, setCreating] = useState(false)
  const cvs = useMemo(() => rememberGraph(doc), [doc])
  const library = useMemo(() => ({ ...doc, cvs }), [doc, cvs])
  const general = useMemo(() => generalCvs(library), [library])
  const forApplications = useMemo(() => applicationCvs(library), [library])
  const copies = useMemo(() => copiesByCv(library), [library])
  const drafts: Drafts = useMemo(
    () =>
      new Map(
        cvs.map((cv) => {
          const snapshot = buildResume(cv.nodes, cv.edges, cv.summary, { sections: doc.sections, bank: doc.bank })
          return [cv.id, { snapshot, analysis: analyzeCv(cv, snapshot, doc.bank) }]
        }),
      ),
    [cvs, doc.sections, doc.bank],
  )
  const statusById = useMemo(() => new Map(doc.applicationStatuses.map((status) => [status.id, status])), [doc.applicationStatuses])
  const titleOf = (id: string | undefined) => (id ? cvs.find((cv) => cv.id === id)?.title : undefined)
  const empty = cvs.length === 0

  return (
    <div className="home cvs-home">
      <header className="cvs-head">
        <div>
          <h1>Mis CVs</h1>
          <p>
            Un CV por rol o perfil: <em>CV React</em>, <em>CV Arquitecto</em>… Cuando te postulás, la postulación arranca de uno y guarda su
            propia copia, adaptada al aviso, sin tocar el original.
          </p>
        </div>
        <div className="cvs-head-actions">
          <button type="button" className="button" onClick={onFromPosting}>
            Desde un aviso
          </button>
          <button type="button" className="button primary" onClick={() => setCreating(true)}>
            + Nuevo CV
          </button>
        </div>
      </header>

      {empty ? (
        <section className="cvs-empty">
          <span className="cvs-empty-sheet" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <h2>Armá tu primer CV</h2>
          <p>Elegí un rol al que apuntás y partí de tu perfil. Después vas a usarlo como base para cada postulación.</p>
          <button type="button" className="button primary" onClick={() => setCreating(true)}>
            + Nuevo CV
          </button>
          {assistant ? <PromptHint prompt="Armame un CV general para roles de <tu rol>" onConnect={assistant.connected ? undefined : assistant.onConnect} /> : null}
        </section>
      ) : (
        <>
          <section className="cvs-group" aria-labelledby="cvs-general">
            <h2 id="cvs-general">
              Generales <span>{general.length}</span>
            </h2>
            <ul className="cvs-grid">
              {general.map((cv) => (
                <li key={cv.id}>
                  <CvCard
                    cv={cv}
                    draft={drafts.get(cv.id)!}
                    doc={doc}
                    basedOn={titleOf(cv.basedOn)}
                    copies={copies.get(cv.id) ?? 0}
                    onOpen={() => onOpen(cv.id)}
                    onCopy={() => onCopy(cv.id)}
                    onRename={(title) => onRename(cv.id, title)}
                    onDelete={() => onDelete(cv.id)}
                  />
                </li>
              ))}
              <li>
                <button type="button" className="cvs-new-card" onClick={() => setCreating(true)}>
                  <span aria-hidden="true">+</span>
                  Nuevo CV
                  <small>Para otro rol o perfil</small>
                </button>
              </li>
            </ul>
          </section>

          <section className="cvs-group" aria-labelledby="cvs-applications">
            <h2 id="cvs-applications">
              De postulaciones <span>{forApplications.length}</span>
            </h2>
            {forApplications.length === 0 ? (
              <p className="cvs-note">
                Cada postulación puede tener su CV: entrá a una postulación, pestaña <strong>CV</strong>, y elegí de qué CV partir.
              </p>
            ) : (
              <ul className="cvs-rows">
                {forApplications.map(({ cv, application }) => {
                  const draft = drafts.get(cv.id)!
                  const attachment = application.attachment
                  const sentIndex = attachment?.kind === 'cv' && attachment.cvId === cv.id && attachment.versionId ? cv.versions.findIndex((version) => version.id === attachment.versionId) : -1
                  return (
                    <li key={cv.id} className="cvs-row-item">
                      <button type="button" className="cvs-row" onClick={() => onOpenApplication(application.id)}>
                        <CompanyLogo name={application.company || '?'} company={companyOf(doc.companies, application)} size={36} />
                        <span className="cvs-row-main">
                          <strong>{application.company || 'Sin empresa'}</strong>
                          <span>{application.title || 'Sin puesto'}</span>
                        </span>
                        <StatusPill status={statusById.get(application.statusId)} />
                        <span className="cvs-row-cv">
                          <span>{cv.title}</span>
                          <small>{titleOf(cv.basedOn) ? `Partió de ${titleOf(cv.basedOn)}` : 'Armado para esta postulación'}</small>
                        </span>
                        <span className="cvs-row-sent">{sentIndex >= 0 ? `Enviada la versión ${sentIndex + 1}` : cv.versions.length > 0 ? `${cv.versions.length} ${cv.versions.length === 1 ? 'versión' : 'versiones'}` : 'Sin versiones'}</span>
                        <ScoreRing score={draft.analysis.score} tone={draft.analysis.grade.tone} size={30} stroke={3} />
                      </button>
                      <CvMenu
                        name={cv.title}
                        deleteNote={`La postulación a ${application.company || 'esta empresa'} se queda sin CV propio.`}
                        items={[
                          { label: 'Abrir en la postulación', run: () => onOpenApplication(application.id) },
                          { label: 'Pasar a generales', run: () => onMakeGeneral(cv.id) },
                        ]}
                        onDelete={() => onDelete(cv.id)}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {creating ? <NewCvDialog cvs={general.length > 0 ? general : cvs} onClose={() => setCreating(false)} onCreate={(input) => { setCreating(false); onCreate(input) }} /> : null}
    </div>
  )
}

function CvCard({
  cv,
  draft,
  doc,
  basedOn,
  copies,
  onOpen,
  onCopy,
  onRename,
  onDelete,
}: {
  cv: Cv
  draft: { snapshot: Snapshot; analysis: CvAnalysis }
  doc: ResumeDocument
  basedOn?: string
  copies: number
  onOpen: () => void
  onCopy: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const latest = cv.versions.at(-1)

  return (
    <article className="cv-card">
      <button type="button" className="cv-card-thumb" onClick={onOpen} aria-label={`Abrir ${cv.title}`} tabIndex={-1}>
        <CvPaper cv={cv} snapshot={draft.snapshot} sections={doc.sections} />
        <span className="cv-card-open">Abrir en el editor</span>
      </button>
      <div className="cv-card-body">
        <div className="cv-card-title">
          {renaming ? (
            <RenameInput
              value={cv.title}
              onDone={(title) => {
                setRenaming(false)
                if (title !== null && title.trim() && title.trim() !== cv.title) onRename(title.trim())
              }}
            />
          ) : (
            <button type="button" className="cv-card-name" onClick={onOpen}>
              {cv.title || 'Sin título'}
            </button>
          )}
          <CvMenu
            name={cv.title}
            deleteNote={copies > 0 ? `Las ${copies} postulaciones que partieron de él conservan su copia.` : ''}
            items={[
              { label: 'Abrir', run: onOpen },
              { label: 'Renombrar', run: () => setRenaming(true) },
              { label: 'Duplicar', run: onCopy },
            ]}
            onDelete={onDelete}
          />
        </div>
        <p className="cv-card-target">{cv.position.trim() || (basedOn ? `Copia de ${basedOn}` : 'Sin puesto definido')}</p>
        <div className="cv-card-meta">
          <span className="cv-card-score" title={`Análisis: ${draft.analysis.score} de 100`}>
            <ScoreRing score={draft.analysis.score} tone={draft.analysis.grade.tone} size={26} stroke={3} />
            {draft.analysis.grade.label}
          </span>
          <span>{latest ? `Guardado ${relativeTime(latest.createdAt)}` : 'Sin versiones'}</span>
          {copies > 0 ? <span className="cv-card-copies">{copies === 1 ? 'Base de 1 postulación' : `Base de ${copies} postulaciones`}</span> : null}
        </div>
      </div>
    </article>
  )
}

/** A CV's "···" menu; deleting asks first, in place. */
function CvMenu({ name, items, deleteNote, onDelete }: { name: string; items: { label: string; run: () => void }[]; deleteNote: string; onDelete: () => void }) {
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (menu === 'closed') return
    function onPointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenu('closed')
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenu('closed')
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <div className="cv-card-menu" ref={menuRef}>
      <button type="button" className="cv-card-more" aria-label={`Acciones para ${name}`} aria-expanded={menu !== 'closed'} onClick={() => setMenu(menu === 'closed' ? 'open' : 'closed')}>
        ···
      </button>
      {menu === 'open' ? (
        <div className="cv-card-popover" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu('closed')
                item.run()
              }}
            >
              {item.label}
            </button>
          ))}
          <button type="button" role="menuitem" className="is-danger" onClick={() => setMenu('confirm')}>
            Eliminar
          </button>
        </div>
      ) : menu === 'confirm' ? (
        <div className="cv-card-popover is-confirm" role="alertdialog" aria-label={`Eliminar ${name}`}>
          <p>
            ¿Eliminar <strong>{name}</strong> y sus versiones? {deleteNote}
          </p>
          <div>
            <button type="button" className="button" onClick={() => setMenu('closed')}>
              Cancelar
            </button>
            <button
              type="button"
              className="button danger"
              onClick={() => {
                setMenu('closed')
                onDelete()
              }}
            >
              Eliminar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function RenameInput({ value, onDone }: { value: string; onDone: (title: string | null) => void }) {
  const [text, setText] = useState(value)
  return (
    <input
      className="cv-card-rename"
      aria-label="Nombre del CV"
      autoFocus
      value={text}
      onChange={(event) => setText(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => onDone(text)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onDone(text)
        if (event.key === 'Escape') onDone(null)
      }}
    />
  )
}

/** "Nuevo CV": a name, the role it aims at, and what to start from. */
function NewCvDialog({ cvs, onClose, onCreate }: { cvs: Cv[]; onClose: () => void; onCreate: (input: NewCvInput) => void }) {
  const [title, setTitle] = useState('')
  const [position, setPosition] = useState('')
  const [start, setStart] = useState<NewCvStart['kind']>('profile')
  const [copyId, setCopyId] = useState(cvs[0]?.id ?? '')

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ready = title.trim() !== '' && (start !== 'copy' || copyId !== '')
  const options: { kind: NewCvStart['kind']; label: string; detail: string }[] = [
    { kind: 'profile', label: 'Todo mi perfil', detail: 'Tus trabajos, estudios y todos tus logros. Después sacás lo que no va para este rol.' },
    ...(cvs.length > 0 ? [{ kind: 'copy' as const, label: 'Una copia de otro CV', detail: 'Mismo contenido y diseño, para adaptarlo a otro rol.' }] : []),
    { kind: 'structure', label: 'Solo la estructura', detail: 'Tus trabajos y estudios, sin logros: los elegís vos uno por uno.' },
  ]

  return (
    <div className="composer-backdrop" onClick={onClose}>
      <form
        className="cv-draft composer cvs-new"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cvs-new-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          if (!ready) return
          onCreate({ title: title.trim(), position: position.trim(), start: start === 'copy' ? { kind: 'copy', cvId: copyId } : { kind: start } })
        }}
      >
        <div className="composer-head">
          <h2 id="cvs-new-title">Nuevo CV</h2>
          <button type="button" className="view-close" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="cvs-new-fields">
          <label className="field">
            <span>Nombre</span>
            <input autoFocus value={title} placeholder="CV React, CV Arquitecto…" onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="field">
            <span>Rol al que apunta (opcional)</span>
            <input value={position} placeholder="Frontend Engineer" onChange={(event) => setPosition(event.target.value)} />
          </label>
        </div>
        <fieldset className="cvs-new-start">
          <legend>Empezar desde</legend>
          {options.map((option) => (
            <label key={option.kind} className={start === option.kind ? 'cvs-start is-on' : 'cvs-start'}>
              <input type="radio" name="cvs-start" checked={start === option.kind} onChange={() => setStart(option.kind)} />
              <span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
                {option.kind === 'copy' && start === 'copy' ? (
                  <select aria-label="CV a copiar" value={copyId} onChange={(event) => setCopyId(event.target.value)}>
                    {cvs.map((cv) => (
                      <option key={cv.id} value={cv.id}>
                        {cv.title || 'Sin título'}
                        {cv.versions.at(-1) ? ` · ${formatDay(cv.versions.at(-1)!.createdAt)}` : ''}
                      </option>
                    ))}
                  </select>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
        <div className="composer-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="button primary" disabled={!ready}>
            Crear CV
          </button>
        </div>
      </form>
    </div>
  )
}
