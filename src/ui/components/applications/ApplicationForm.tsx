import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { companyFromUrl } from '../../../domain/applicationFilters'
import {
  findDuplicates,
  type Application,
  type ApplicationAttachment,
  type ApplicationStatus,
} from '../../../domain/applications'
import type { Cv } from '../../../domain/model'
import { todayYmd } from '../../format'
import { DuplicateAlert } from './DuplicateAlert'
import { CvAttachmentPicker } from './CvAttachmentPicker'

export type ApplicationFormValues = {
  url: string
  company: string
  title: string
  location: string
  appliedOn: string
  posting: string
  note: string
  attachment: ApplicationAttachment | null
}

type ApplicationFormProps = {
  /** null: new application. */
  initial: Application | null
  applications: Application[]
  statuses: ApplicationStatus[]
  cvs: Cv[]
  onSubmit: (values: ApplicationFormValues, options: { buildCv: boolean }) => void
  onCancel: () => void
  onOpen: (applicationId: string) => void
}

export function ApplicationForm({ initial, applications, statuses, cvs, onSubmit, onCancel, onOpen }: ApplicationFormProps) {
  const [values, setValues] = useState<ApplicationFormValues>(() => ({
    url: initial?.url ?? '',
    company: initial?.company ?? '',
    title: initial?.title ?? '',
    location: initial?.location ?? '',
    appliedOn: initial?.appliedOn ?? todayYmd(),
    posting: initial?.posting ?? '',
    note: '',
    attachment: initial?.attachment ?? null,
  }))
  const [companyTouched, setCompanyTouched] = useState(Boolean(initial?.company))
  const [buildCv, setBuildCv] = useState(false)
  const urlRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    urlRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const duplicates = useMemo(
    () => findDuplicates(applications, { company: values.company, title: values.title, url: values.url }, initial?.id),
    [applications, values.company, values.title, values.url, initial?.id],
  )
  const strongDuplicate = duplicates.some((match) => match.reason !== 'same-company')
  const missing = [!values.company.trim() && 'empresa', !values.title.trim() && 'puesto'].filter(Boolean)

  function set<K extends keyof ApplicationFormValues>(key: K, value: ApplicationFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function changeUrl(url: string) {
    setValues((current) => {
      const guess = companyTouched ? '' : companyFromUrl(url)
      return { ...current, url, company: companyTouched ? current.company : guess }
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (missing.length > 0) return
    onSubmit(values, { buildCv: buildCv && !values.attachment })
  }

  return (
    <div className="composer-backdrop" onClick={onCancel}>
      <form
        className="cv-draft composer composer-wide application-form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="application-form-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="composer-head">
          <h2 id="application-form-title">{initial ? 'Editar postulación' : 'Nueva postulación'}</h2>
          <button type="button" className="view-close" aria-label="Cerrar" onClick={onCancel}>
            ×
          </button>
        </div>

        <label className="field">
          <span>Link del aviso</span>
          <input
            ref={urlRef}
            type="url"
            inputMode="url"
            value={values.url}
            placeholder="https://www.linkedin.com/jobs/view/…"
            onChange={(event) => changeUrl(event.target.value)}
          />
        </label>

        <div className="application-form-row">
          <label className="field">
            <span>Empresa</span>
            <input
              value={values.company}
              placeholder="Acme"
              required
              onChange={(event) => {
                setCompanyTouched(true)
                set('company', event.target.value)
              }}
            />
          </label>
          <label className="field">
            <span>Puesto</span>
            <input value={values.title} placeholder="Senior Backend Engineer" required onChange={(event) => set('title', event.target.value)} />
          </label>
        </div>

        <div className="application-form-row">
          <label className="field">
            <span>Ubicación</span>
            <input value={values.location} placeholder="Remoto, Buenos Aires…" onChange={(event) => set('location', event.target.value)} />
          </label>
          <label className="field">
            <span>Fecha de postulación</span>
            <input type="date" value={values.appliedOn} onChange={(event) => set('appliedOn', event.target.value)} />
          </label>
        </div>

        <DuplicateAlert matches={duplicates} statuses={statuses} onOpen={onOpen} />

        <label className="field">
          <span>Aviso</span>
          <textarea
            className="application-posting"
            value={values.posting}
            placeholder="Pegá el texto del aviso (opcional). Sirve para armar el CV y para que Claude lo analice."
            onChange={(event) => set('posting', event.target.value)}
          />
        </label>

        <div className="field">
          <span>CV enviado</span>
          <CvAttachmentPicker cvs={cvs} value={values.attachment} onChange={(attachment) => set('attachment', attachment)} />
        </div>
        {!initial && !values.attachment ? (
          <label className="checkbox-row">
            <input type="checkbox" checked={buildCv} onChange={(event) => setBuildCv(event.target.checked)} />
            Al guardar, armar su CV (elegís de qué CV partir)
          </label>
        ) : null}

        {!initial ? (
          <label className="field">
            <span>Nota</span>
            <input value={values.note} placeholder="Referido por…, salario pedido…, contacto…" onChange={(event) => set('note', event.target.value)} />
          </label>
        ) : null}

        <div className="composer-actions">
          {missing.length > 0 ? <span className="form-hint">Falta {missing.join(' y ')}</span> : null}
          <button type="button" className="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="button primary" disabled={missing.length > 0}>
            {initial ? 'Guardar' : strongDuplicate ? 'Postularme igual' : 'Guardar postulación'}
          </button>
        </div>
      </form>
    </div>
  )
}
