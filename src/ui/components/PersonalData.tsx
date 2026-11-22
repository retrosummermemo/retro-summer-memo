import { useEffect, useMemo, useRef, useState } from 'react'
import {
  emptyEducationEntry,
  emptyJob,
  emptyJobRole,
  type EducationEntry,
  type Job,
  type JobRole,
  type Profile,
  type ProfileField,
} from '../../domain/model'
import { applyLinkedInImport, linkedInImportSummary, parseLinkedInPaste } from '../../domain/linkedinImport'

type PersonalDataProps = {
  profile: Profile
  onProfile: (patch: Partial<Profile>) => void
}

/** Name, contact fields, studies and jobs: what every CV header and history comes from. */
export function PersonalData({ profile, onProfile }: PersonalDataProps) {
  const [draftId, setDraftId] = useState<string | null>(null)
  const [linkedinOpen, setLinkedinOpen] = useState(false)
  const [linkedinPaste, setLinkedinPaste] = useState('')
  const [linkedinError, setLinkedinError] = useState('')
  const draftRef = useRef<HTMLInputElement>(null)
  const linkedinRef = useRef<HTMLTextAreaElement>(null)
  const linkedinPreview = useMemo(() => (linkedinPaste.trim() ? parseLinkedInPaste(linkedinPaste) : null), [linkedinPaste])

  useEffect(() => {
    if (!draftId) return
    draftRef.current?.focus()
  }, [draftId, profile.fields])

  useEffect(() => {
    if (!linkedinOpen) return
    linkedinRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setLinkedinOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [linkedinOpen])

  function openLinkedInImport() {
    setLinkedinPaste('')
    setLinkedinError('')
    setLinkedinOpen(true)
  }

  function importFromLinkedIn() {
    const imported = parseLinkedInPaste(linkedinPaste)
    const hasWork = imported.jobs.length > 0 || imported.education.length > 0
    const hasIdentity = imported.name.trim() !== '' || imported.location.trim() !== '' || imported.linkedInUrl !== ''
    if (!hasWork && !hasIdentity) {
      setLinkedinError('Pegá el texto de tu perfil de LinkedIn (Experiencia + Educación) y, si querés, el link del perfil.')
      return
    }
    if (!hasWork) {
      onProfile(applyLinkedInImport(profile, imported))
      setLinkedinError(
        'Guardamos el link/nombre. LinkedIn no deja leer la página desde acá — copiá Experiencia + Educación de tu perfil (o Más → Guardar en PDF → pegá el texto) e importá de nuevo.',
      )
      return
    }
    onProfile(applyLinkedInImport(profile, imported))
    setLinkedinOpen(false)
  }

  function patchField(id: string, patch: Partial<Pick<ProfileField, 'label' | 'value'>>) {
    onProfile({
      fields: profile.fields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    })
  }

  function addField() {
    const id = crypto.randomUUID()
    setDraftId(id)
    onProfile({
      fields: [...profile.fields, { id, label: '', value: '', kind: 'text' }],
    })
  }

  function patchEducation(id: string, patch: Partial<Omit<EducationEntry, 'id'>>) {
    onProfile({
      education: profile.education.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    })
  }

  function addEducation() {
    onProfile({ education: [...profile.education, emptyEducationEntry()] })
  }

  function removeEducation(id: string) {
    onProfile({ education: profile.education.filter((entry) => entry.id !== id) })
  }

  function patchJob(id: string, patch: Partial<Pick<Job, 'company'>>) {
    onProfile({
      jobs: profile.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
    })
  }

  function addJob() {
    onProfile({ jobs: [...profile.jobs, emptyJob()] })
  }

  function removeJob(id: string) {
    onProfile({ jobs: profile.jobs.filter((job) => job.id !== id) })
  }

  function patchJobRole(jobId: string, roleId: string, patch: Partial<Omit<JobRole, 'id'>>) {
    onProfile({
      jobs: profile.jobs.map((job) => (
        job.id === jobId
          ? { ...job, roles: job.roles.map((role) => (role.id === roleId ? { ...role, ...patch } : role)) }
          : job
      )),
    })
  }

  function addJobRole(jobId: string) {
    onProfile({
      jobs: profile.jobs.map((job) => (
        job.id === jobId ? { ...job, roles: [...job.roles, emptyJobRole()] } : job
      )),
    })
  }

  function removeJobRole(jobId: string, roleId: string) {
    onProfile({
      jobs: profile.jobs.map((job) => {
        if (job.id !== jobId) return job
        const roles = job.roles.filter((role) => role.id !== roleId)
        return { ...job, roles: roles.length > 0 ? roles : [emptyJobRole()] }
      }),
    })
  }

  return (
    <div className="home profile-home">
        <>
          <div className="home-head">
            <p className="profile-lede">Tus datos de contacto, estudios y trabajos: de acá salen el encabezado y la trayectoria de todos tus CVs.</p>
            <button type="button" className="button" onClick={openLinkedInImport}>
              Importar de LinkedIn
            </button>
          </div>
          <label className="field personal-name">
            <span>Nombre</span>
            <input value={profile.name} onChange={(event) => onProfile({ name: event.target.value })} />
          </label>
          <div className="personal-sheet">
            <table className="source-table personal-table">
              <thead>
                <tr>
                  <th className="col-index" />
                  <th>Etiqueta</th>
                  <th>Valor</th>
                  <th className="col-remove" />
                </tr>
              </thead>
              <tbody>
                {profile.fields.map((field, index) => (
                  <tr key={field.id}>
                    <td className="col-index">{index + 1}</td>
                    <td>
                      <input
                        ref={field.id === draftId ? draftRef : undefined}
                        aria-label={`Etiqueta ${index + 1}`}
                        value={field.label}
                        placeholder={field.kind === 'link' ? 'Perfil de GitHub' : 'Etiqueta'}
                        onChange={(event) => patchField(field.id, { label: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={field.label || `Valor ${index + 1}`}
                        type={fieldInputType(field.kind)}
                        value={field.value}
                        placeholder={field.kind === 'link' ? 'https://' : ''}
                        onChange={(event) => patchField(field.id, { value: event.target.value })}
                      />
                    </td>
                    <td className="col-remove">
                      <button
                        type="button"
                        className="row-remove"
                        aria-label={`Eliminar ${field.label || 'campo'}`}
                        onClick={() => onProfile({ fields: profile.fields.filter((item) => item.id !== field.id) })}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="button personal-add" onClick={addField}>
            Nuevo campo
          </button>

          <h2 className="personal-section-title">Educación</h2>
          <div className="personal-sheet">
            <table className="source-table personal-table personal-education-table">
              <thead>
                <tr>
                  <th className="col-index" />
                  <th>Institución</th>
                  <th>Título</th>
                  <th>Inicio</th>
                  <th>Fin</th>
                  <th className="col-remove" />
                </tr>
              </thead>
              <tbody>
                {profile.education.length === 0 ? (
                  <tr>
                    <td className="col-index" />
                    <td colSpan={5} className="personal-empty-cell">
                      Instituciones y títulos para tu CV.
                    </td>
                  </tr>
                ) : (
                  profile.education.map((entry, index) => (
                    <tr key={entry.id}>
                      <td className="col-index">{index + 1}</td>
                      <td>
                        <input
                          aria-label={`Institución ${index + 1}`}
                          value={entry.school}
                          placeholder="Universidad"
                          onChange={(event) => patchEducation(entry.id, { school: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Título ${index + 1}`}
                          value={entry.degree}
                          placeholder="B.S. Computer Science"
                          onChange={(event) => patchEducation(entry.id, { degree: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Inicio de educación ${index + 1}`}
                          value={entry.start}
                          placeholder="2016"
                          onChange={(event) => patchEducation(entry.id, { start: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Fin de educación ${index + 1}`}
                          value={entry.end}
                          placeholder="2020"
                          onChange={(event) => patchEducation(entry.id, { end: event.target.value })}
                        />
                      </td>
                      <td className="col-remove">
                        <button
                          type="button"
                          className="row-remove"
                          aria-label={`Eliminar educación ${index + 1}`}
                          onClick={() => removeEducation(entry.id)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <button type="button" className="button personal-add" onClick={addEducation}>
            Agregar educación
          </button>

          <h2 className="personal-section-title">Trabajos</h2>
          <p className="personal-section-lede">
            Agregá la ubicación y, si te ascendieron, otro puesto dentro de la misma empresa.
          </p>
          {profile.jobs.length === 0 ? (
            <div className="personal-sheet personal-job">
              <p className="personal-empty">Todavía no hay trabajos.</p>
            </div>
          ) : (
            profile.jobs.map((job, jobIndex) => (
              <div key={job.id} className="personal-sheet personal-job">
                <div className="personal-job-head">
                  <label className="field personal-job-company">
                    <span>Empresa</span>
                    <input
                      aria-label={`Empresa ${jobIndex + 1}`}
                      value={job.company}
                      placeholder="Acme"
                      onChange={(event) => patchJob(job.id, { company: event.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="row-remove personal-job-remove"
                    aria-label={`Eliminar empresa ${job.company || jobIndex + 1}`}
                    onClick={() => removeJob(job.id)}
                  >
                    ×
                  </button>
                </div>
                <table className="source-table personal-table personal-roles-table">
                  <thead>
                    <tr>
                      <th className="col-index" />
                      <th>Puesto</th>
                      <th>Ubicación</th>
                      <th>Inicio</th>
                      <th>Fin</th>
                      <th className="col-remove" />
                    </tr>
                  </thead>
                  <tbody>
                    {job.roles.map((role, roleIndex) => (
                      <tr key={role.id}>
                        <td className="col-index">{roleIndex + 1}</td>
                        <td>
                          <input
                            aria-label={`Puesto ${roleIndex + 1} de ${job.company || 'la empresa'}`}
                            value={role.title}
                            placeholder={roleIndex === 0 ? 'Software Engineer' : 'Senior Software Engineer'}
                            onChange={(event) => patchJobRole(job.id, role.id, { title: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Ubicación del puesto ${roleIndex + 1} de ${job.company || 'la empresa'}`}
                            value={role.location}
                            placeholder="Ciudad, País"
                            onChange={(event) => patchJobRole(job.id, role.id, { location: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Inicio del puesto ${roleIndex + 1}`}
                            value={role.start}
                            placeholder="2021"
                            onChange={(event) => patchJobRole(job.id, role.id, { start: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Fin del puesto ${roleIndex + 1}`}
                            value={role.end}
                            placeholder={roleIndex === job.roles.length - 1 ? 'Actualidad' : '2023'}
                            onChange={(event) => patchJobRole(job.id, role.id, { end: event.target.value })}
                          />
                        </td>
                        <td className="col-remove">
                          <button
                            type="button"
                            className="row-remove"
                            aria-label={`Eliminar puesto ${role.title || roleIndex + 1}`}
                            onClick={() => removeJobRole(job.id, role.id)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="button personal-add-role" onClick={() => addJobRole(job.id)}>
                  Agregar puesto
                </button>
              </div>
            ))
          )}
          <button type="button" className="button personal-add" onClick={addJob}>
            Agregar empresa
          </button>
        </>
      {linkedinOpen ? (
        <div className="composer-backdrop" onClick={() => setLinkedinOpen(false)}>
          <div
            className="cv-draft composer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="linkedin-import-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="composer-head">
              <h2 id="linkedin-import-title">Importar de LinkedIn</h2>
              <button type="button" className="view-close" aria-label="Cerrar" onClick={() => setLinkedinOpen(false)}>
                ×
              </button>
            </div>
            <p className="personal-section-lede linkedin-import-lede">
              LinkedIn no deja leer un perfil solo con el link. Lo más rápido: abrí tu perfil → copiá Experiencia y Educación
              (o Más → Guardar en PDF → seleccioná todo → copiá) y pegalo abajo. También podés incluir la URL del perfil.
            </p>
            <label className="field">
              <span>Pegar</span>
              <textarea
                ref={linkedinRef}
                className="linkedin-import-paste"
                value={linkedinPaste}
                placeholder={'https://www.linkedin.com/in/tu-perfil\n\nExperiencia\nAcme\nJornada completa · 4 años\nSenior Engineer\nEne 2023 - Actualidad\nEngineer\nEne 2021 - Ene 2023\n\nEducación\nUniversidad Nacional\nB.S. Computer Science\n2016 - 2020'}
                onChange={(event) => {
                  setLinkedinPaste(event.target.value)
                  setLinkedinError('')
                }}
              />
            </label>
            {linkedinPreview && linkedInImportSummary(linkedinPreview) ? (
              <p className="linkedin-import-preview" role="status">
                Se va a importar: {linkedInImportSummary(linkedinPreview)}
              </p>
            ) : null}
            {linkedinError ? <p className="linkedin-import-error" role="alert">{linkedinError}</p> : null}
            <div className="composer-actions">
              <button type="button" className="button" onClick={() => setLinkedinOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="button primary" onClick={importFromLinkedIn}>
                Importar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function fieldInputType(kind: ProfileField['kind']) {
  if (kind === 'email') return 'email'
  if (kind === 'phone') return 'tel'
  return 'text'
}
