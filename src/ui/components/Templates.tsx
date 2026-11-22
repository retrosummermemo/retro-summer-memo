import { Fragment, useEffect, useRef, useState } from 'react'
import type { SectionView } from '../../domain/content'
import type { Experience } from '../../domain/experiences'
import type { CatalogSection, Job, RoleGraph, SectionEntry } from '../../domain/model'
import { RoleGraphs } from './RoleGraphs'

type LibraryProps = {
  sections: CatalogSection[]
  roleGraphs: RoleGraph[]
  bank: Experience[]
  jobs: Job[]
  onChange: (update: (sections: CatalogSection[]) => CatalogSection[]) => void
  onChangeRoles: (graphs: RoleGraph[]) => void
  /** Every section with its entries (Experience and Education come from the profile). */
  views?: SectionView[]
}

type LibraryPage = 'sections' | 'roles'

export function Library({ sections, roleGraphs, bank, jobs, onChange, onChangeRoles, views = [] }: LibraryProps) {
  const [page, setPage] = useState<LibraryPage>('sections')
  const [openId, setOpenId] = useState<string | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const draftRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!draftId) return
    draftRef.current?.focus()
  }, [draftId, sections])

  function patch(id: string, next: Partial<Pick<CatalogSection, 'name' | 'description' | 'active'>>) {
    onChange((current) => current.map((section) => (section.id === id ? { ...section, ...next } : section)))
  }

  function addSection() {
    const id = crypto.randomUUID()
    setDraftId(id)
    onChange((current) => [...current, { id, name: '', description: '', active: true, builtIn: false }])
  }

  return (
    <div className="home">
      <div className="home-head">
        <p className="profile-lede">
          {page === 'sections'
            ? 'Las secciones que pueden tener tus CVs (Experiencia, Educación, Proyectos, Certificaciones…) y lo que hay en cada una.'
            : 'Puestos armados como plantillas, para sumarlos al grafo de un CV.'}
        </p>
        <div className="segment" role="group" aria-label="Qué ver">
          <button type="button" className={page === 'sections' ? 'is-current' : undefined} aria-pressed={page === 'sections'} onClick={() => setPage('sections')}>
            Secciones · {sections.length}
          </button>
          <button type="button" className={page === 'roles' ? 'is-current' : undefined} aria-pressed={page === 'roles'} onClick={() => setPage('roles')}>
            Plantillas de puestos · {roleGraphs.length}
          </button>
        </div>
      </div>
      {page === 'roles' ? <RoleGraphs graphs={roleGraphs} bank={bank} jobs={jobs} onChange={onChangeRoles} /> : (
      <>
      <div className="personal-sheet">
        <table className="source-table personal-table">
          <thead>
            <tr>
              <th className="col-index" />
              <th>Sección</th>
              <th>Descripción</th>
              <th className="col-entries">Entradas</th>
              <th className="col-active">Activa</th>
              <th className="col-remove" />
            </tr>
          </thead>
          <tbody>
            {sections.map((section, index) => {
              const name = section.name.trim() || 'sección'
              const view = views.find((item) => item.id === section.id)
              return (
                <Fragment key={section.id}>
                <tr>
                  <td className="col-index">{index + 1}</td>
                  <td>
                    <input
                      ref={section.id === draftId ? draftRef : undefined}
                      aria-label={`Sección ${index + 1}`}
                      value={section.name}
                      placeholder="Premios"
                      onChange={(event) => patch(section.id, { name: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Descripción ${index + 1}`}
                      value={section.description}
                      placeholder="Descripción"
                      onChange={(event) => patch(section.id, { description: event.target.value })}
                    />
                  </td>
                  <td className="col-entries">
                    {view && view.source !== 'none' ? (
                      <button
                        type="button"
                        className="link-button"
                        aria-expanded={openId === section.id}
                        onClick={() => setOpenId((current) => (current === section.id ? null : section.id))}
                      >
                        {view.entries.length} {openId === section.id ? '▴' : '▾'}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="col-active">
                    <input
                      type="checkbox"
                      aria-label={`Activa: ${name}`}
                      checked={section.active}
                      onChange={(event) => patch(section.id, { active: event.target.checked })}
                    />
                  </td>
                  <td className="col-remove">
                    {section.builtIn ? null : (
                      <button
                        type="button"
                        className="row-remove"
                        aria-label={`Eliminar ${name}`}
                        onClick={() => onChange((current) => current.filter((item) => item.id !== section.id))}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
                {openId === section.id && view ? (
                  <tr className="section-entries-row">
                    <td />
                    <td colSpan={5}>
                      {view.source === 'profile' ? (
                        <p className="form-hint">
                          {view.entries.length > 0
                            ? view.entries.map((entry) => [entry.title, entry.subtitle].filter(Boolean).join(' — ')).join(' · ')
                            : 'Todavía no hay entradas.'}{' '}
                          Se editan en Personal (o pedíselo a tu asistente).
                        </p>
                      ) : (
                        <SectionEntries
                          entries={section.entries ?? []}
                          onChange={(entries) => onChange((current) => current.map((item) => (item.id === section.id ? { ...item, entries } : item)))}
                        />
                      )}
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="button personal-add" onClick={addSection}>
        Nueva sección
      </button>
      </>
      )}
    </div>
  )
}

const entryFields: { key: keyof Omit<SectionEntry, 'id' | 'extra'>; label: string; placeholder: string }[] = [
  { key: 'title', label: 'Título', placeholder: 'Weball, AWS Solutions Architect…' },
  { key: 'subtitle', label: 'Subtítulo', placeholder: 'Rol, institución, nivel…' },
  { key: 'location', label: 'Lugar', placeholder: 'Remoto' },
  { key: 'start', label: 'Inicio', placeholder: '2024' },
  { key: 'end', label: 'Fin', placeholder: 'Actualidad' },
  { key: 'url', label: 'Link', placeholder: 'https://…' },
  { key: 'description', label: 'Descripción', placeholder: 'Una línea sobre qué es' },
]

/** The items of a section (projects, certifications…): add, edit and remove. */
function SectionEntries({ entries, onChange }: { entries: SectionEntry[]; onChange: (entries: SectionEntry[]) => void }) {
  function patch(id: string, key: keyof SectionEntry, value: string) {
    onChange(entries.map((entry) => (entry.id === id ? { ...entry, [key]: value } : entry)))
  }

  function add() {
    onChange([...entries, { id: crypto.randomUUID(), title: '', subtitle: '', location: '', start: '', end: '', description: '', url: '' }])
  }

  return (
    <div className="section-entries">
      {entries.map((entry, index) => (
        <div key={entry.id} className="section-entry">
          {entryFields.map((field) => (
            <label key={field.key} className={`section-entry-field is-${field.key}`}>
              <span>{field.label}</span>
              <input
                aria-label={`${field.label} ${index + 1}`}
                value={entry[field.key]}
                placeholder={field.placeholder}
                onChange={(event) => patch(entry.id, field.key, event.target.value)}
              />
            </label>
          ))}
          <button
            type="button"
            className="icon-button"
            aria-label={`Eliminar ${entry.title || `entrada ${index + 1}`}`}
            title="Eliminar"
            onClick={() => onChange(entries.filter((item) => item.id !== entry.id))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="button" onClick={add}>
        Agregar entrada
      </button>
    </div>
  )
}
