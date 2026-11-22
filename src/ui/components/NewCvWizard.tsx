import { useEffect, useMemo, useState } from 'react'
import { EXAMPLE_POSTING, experienceLevels, matchExperiencesToPosting, type Experience } from '../../domain/experiences'
import type { KnowledgeAnswer } from '../../domain/model'
import type { CvDraft } from '../../domain/documentOps'
import { defaultFont, fonts, type FontId } from '../../domain/fonts'
import { templates, type TemplateId } from '../../domain/templates'

/** Values to start the new-CV wizard with (e.g. from a job application), instead of the example. */
export type ComposerSeed = {
  title: string
  position: string
  company: string
  posting: string
}

type NewCvWizardProps = {
  bank: Experience[]
  knowledge: KnowledgeAnswer[]
  seed?: ComposerSeed | null
  onClose: () => void
  onCreate: (draft: CvDraft) => void
}

type WizardStep = 'posting' | 'pick' | 'style'

/** A CV from a posting: paste it, pick the experiences that match, choose the look. */
export function NewCvWizard({ bank, knowledge, seed = null, onClose, onCreate }: NewCvWizardProps) {
  // Mounted when it opens: it starts from the seed (or the example) with the matching experiences picked.
  const [start] = useState(() => seed ?? { title: 'Software Engineer', position: 'Software Engineer', company: 'Platform', posting: EXAMPLE_POSTING })
  const levelById = useMemo(() => new Map(knowledge.map((answer) => [answer.id, answer.level])), [knowledge])
  const masterItems = useMemo(() => bank.filter((item) => (levelById.get(item.id) ?? 0) > 0), [bank, levelById])
  const [step, setStep] = useState<WizardStep>('posting')
  const [title, setTitle] = useState(start.title)
  const [position, setPosition] = useState(start.position)
  const [company, setCompany] = useState(start.company)
  const [posting, setPosting] = useState(start.posting)
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        matchExperiencesToPosting(start.posting, masterItems.length > 0 ? masterItems : bank)
          .filter((row) => row.score > 0)
          .slice(0, 8)
          .map((row) => row.item.id),
      ),
  )
  const [templateId, setTemplateId] = useState<TemplateId>('classic')
  const [fontId, setFontId] = useState<FontId>('times')
  const ranked = useMemo(() => matchExperiencesToPosting(posting, masterItems.length > 0 ? masterItems : bank), [posting, masterItems, bank])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function create() {
    onCreate({ title, position, company, posting, templateId, fontId, experienceIds: [...selected] })
  }

  function toggleExperience(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function useExample() {
    setPosting(EXAMPLE_POSTING)
    setTitle('Software Engineer')
    setPosition('Software Engineer')
    setCompany('Platform')
  }

  return (
    <div className="composer-backdrop" onClick={() => onClose()}>
      <div
        className="cv-draft composer composer-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="composer-head">
          <h2 id="new-project-title">Nuevo CV</h2>
          <button type="button" className="view-close" aria-label="Cerrar" onClick={() => onClose()}>
            ×
          </button>
        </div>

        <ol className="wizard-steps" aria-label="Pasos">
          <li className={step === 'posting' ? 'is-current' : undefined}>Aviso</li>
          <li className={step === 'pick' ? 'is-current' : undefined}>Experiencias</li>
          <li className={step === 'style' ? 'is-current' : undefined}>Estilo</li>
        </ol>

        {step === 'posting' ? (
          <>
            <div className="wizard-meta-row">
              <label className="field">
                <span>Título</span>
                <input value={title} placeholder="Software Engineer" onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="field">
                <span>Cargo</span>
                <input value={position} placeholder="Software Engineer" onChange={(event) => setPosition(event.target.value)} />
              </label>
              <label className="field">
                <span>Empresa</span>
                <input value={company} placeholder="Acme" onChange={(event) => setCompany(event.target.value)} />
              </label>
            </div>
            <div className="wizard-posting-head">
              <span className="menu-label">Aviso</span>
              {seed ? null : (
                <button type="button" className="button" onClick={useExample}>
                  Usar ejemplo
                </button>
              )}
            </div>
            <label className="field">
              <span className="sr-only">Aviso</span>
              <textarea
                className="wizard-posting"
                value={posting}
                placeholder="Pegá uno o más avisos…"
                onChange={(event) => setPosting(event.target.value)}
              />
            </label>
            <div className="composer-actions">
              <button type="button" className="button" onClick={() => onClose()}>
                Cancelar
              </button>
              <button type="button" className="button primary" onClick={() => setStep('pick')}>
                Siguiente
              </button>
            </div>
          </>
        ) : null}

        {step === 'pick' ? (
          <>
            <p className="knowledge-lede">
              Marcá experiencias de tu master para precargar este CV.
              {masterItems.length === 0 ? ' Todavía no respondiste preguntas — se muestran todas las experiencias.' : null}
            </p>
            <ul className="wizard-pick-list">
              {ranked.map(({ item, score }) => (
                <li key={item.id}>
                  <label className={selected.has(item.id) ? 'wizard-pick is-on' : 'wizard-pick'}>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleExperience(item.id)}
                    />
                    <span className="wizard-pick-body">
                      <span className="wizard-pick-text">{item.text}</span>
                      <span className="wizard-pick-meta">
                        {item.category}
                        {item.skills.length > 0 ? ` · ${item.skills.join(', ')}` : ''}
                        {score > 0 ? ` · coincidencia ${score}` : ''}
                        {levelLabel(levelById.get(item.id))}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="composer-actions">
              <button type="button" className="button" onClick={() => setStep('posting')}>
                Atrás
              </button>
              <button type="button" className="button primary" onClick={() => setStep('style')}>
                Siguiente
              </button>
            </div>
          </>
        ) : null}

        {step === 'style' ? (
          <>
            <p className="menu-label">Plantilla</p>
            <div className="template-choices">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={template.id === templateId ? 'template-choice is-current' : 'template-choice'}
                  aria-pressed={template.id === templateId}
                  onClick={() => {
                    setTemplateId(template.id)
                    setFontId(defaultFont(template.id))
                  }}
                >
                  <TemplateMark id={template.id} />
                  <span className="template-name">{template.name}</span>
                  <span className="template-detail">{template.detail}</span>
                </button>
              ))}
            </div>
            <p className="menu-label">Fuente</p>
            <div className="font-choices">
              {fonts.map((font) => (
                <button
                  key={font.id}
                  type="button"
                  className={font.id === fontId ? 'font-choice is-current' : 'font-choice'}
                  style={{ fontFamily: font.family }}
                  aria-pressed={font.id === fontId}
                  onClick={() => setFontId(font.id)}
                >
                  {font.name}
                </button>
              ))}
            </div>
            <p className="wizard-seed-note">
              Arma el CV con tus trabajos y estudios, y {selected.size === 1 ? 'la experiencia elegida' : `las ${selected.size} experiencias elegidas`} en el
              trabajo o proyecto donde pasaron.
            </p>
            <div className="composer-actions">
              <button type="button" className="button" onClick={() => setStep('pick')}>
                Atrás
              </button>
              <button type="button" className="button primary" onClick={create}>
                Crear
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

function levelLabel(level: number | undefined) {
  if (level === undefined) return ''
  const label = experienceLevels.find((choice) => choice.level === level)?.label
  return label ? ` · ${label}` : ''
}

function TemplateMark({ id }: { id: TemplateId }) {
  if (id === 'sidebar') {
    return (
      <span className="template-mark is-sidebar" aria-hidden="true">
        <span className="mark-rail" />
        <span className="mark-main" />
      </span>
    )
  }
  if (id === 'timeline') {
    return (
      <span className="template-mark is-timeline" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    )
  }
  return (
    <span className={`template-mark is-${id}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}
