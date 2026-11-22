import { useMemo } from 'react'
import type { Application, ApplicationAttachment } from '../../../domain/applications'
import { analyzeCv } from '../../../domain/cvAnalysis'
import { generalCvs } from '../../../domain/cvLibrary'
import { keywordMatch } from '../../../domain/cvReview'
import { rememberGraph } from '../../../domain/documentOps'
import { buildResume, type ResumeDocument } from '../../../domain/model'
import { PromptHint } from '../assistant/PromptHint'
import { CvPaper } from '../cvs/CvPaper'
import { ScoreRing } from '../editor/ScoreRing'
import { CvAttachmentPicker } from './CvAttachmentPicker'
import { versionLabel } from './cvs'

type ApplicationCvStartProps = {
  application: Application
  doc: ResumeDocument
  /** Makes this application's CV as a copy of a general one. */
  onCopyFrom: (cvId: string) => void
  /** The new-CV wizard, seeded with this posting. */
  onFromPosting: () => void
  onOpenCv: (cvId: string) => void
  onRecordSent: (attachment: ApplicationAttachment | null) => void
  assistant?: { connected: boolean; onConnect: () => void }
}

/**
 * An application without its own CV: pick the general CV to start from (the one closest to the
 * posting first). The copy is this application's; the original stays as it is.
 */
export function ApplicationCvStart({ application, doc, onCopyFrom, onFromPosting, onOpenCv, onRecordSent, assistant }: ApplicationCvStartProps) {
  const company = application.company || 'esta empresa'
  const options = useMemo(() => {
    const cvs = rememberGraph(doc)
    return generalCvs({ cvs, applications: doc.applications })
      .map((cv) => {
        const snapshot = buildResume(cv.nodes, cv.edges, cv.summary, { sections: doc.sections, bank: doc.bank })
        const keywords = keywordMatch(snapshot, doc.bank, application.posting)
        const total = keywords ? keywords.covered.length + keywords.backedButMissing.length + keywords.notInExperience.length : 0
        return { cv, snapshot, analysis: analyzeCv(cv, snapshot, doc.bank), covered: keywords?.covered.length ?? 0, total }
      })
      // Every CV is matched against the same terms of the posting: more covered, closer to it.
      .sort((left, right) => right.covered - left.covered)
  }, [doc, application.posting])
  const attachment = application.attachment
  const sent = attachment?.kind === 'cv' ? doc.cvs.find((cv) => cv.id === attachment.cvId) : undefined
  const sentVersion = sent && attachment?.kind === 'cv' ? sent.versions.find((version) => version.id === attachment.versionId) : undefined
  // Worth pointing out only when one covers more of the posting than every other.
  const best = options.length > 1 && options[0].total > 0 && options[0].covered > options[1].covered ? options[0].cv.id : null

  return (
    <div className="app-cv-start">
      <div className="app-cv-start-inner">
        <header>
          <h2>El CV para {company}</h2>
          <p>
            Elegí de qué CV partir. Se hace una copia solo para esta postulación: la adaptás al aviso sin tocar el original, y queda guardada
            junto al proceso.
          </p>
        </header>

        {sent ? (
          <div className="app-cv-sent" role="status">
            <span>
              Registraste que mandaste <strong>{sent.title}</strong>
              {sentVersion ? ` (${versionLabel(sent, sentVersion).toLowerCase()})` : ''}.
            </span>
            <button type="button" className="link-button" onClick={() => onOpenCv(sent.id)}>
              Ver ese CV
            </button>
          </div>
        ) : null}

        {options.length > 0 ? (
          <ul className="app-cv-options">
            {options.map(({ cv, snapshot, analysis, covered, total }) => (
              <li key={cv.id}>
                <button type="button" className={cv.id === best ? 'app-cv-option is-best' : 'app-cv-option'} onClick={() => onCopyFrom(cv.id)}>
                  <span className="app-cv-option-thumb">
                    <CvPaper cv={cv} snapshot={snapshot} sections={doc.sections} />
                    {cv.id === best ? <span className="app-cv-best">Más afín al aviso</span> : null}
                  </span>
                  <span className="app-cv-option-body">
                    <strong>{cv.title || 'Sin título'}</strong>
                    <span>{cv.position.trim() || 'Sin puesto definido'}</span>
                    <span className="app-cv-option-meta">
                      <ScoreRing score={analysis.score} tone={analysis.grade.tone} size={24} stroke={3} />
                      {total > 0 ? `${covered} de ${total} términos del aviso` : analysis.grade.label}
                    </span>
                  </span>
                  <span className="app-cv-option-use">Partir de este</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="app-cv-none">Todavía no tenés CVs generales. Armá uno para esta postulación desde el aviso, o creá tus CVs por rol en Mis CVs.</p>
        )}

        <div className="app-cv-or">
          <span>o</span>
        </div>

        <div className="app-cv-alternatives">
          <button type="button" className="button" onClick={onFromPosting}>
            Armar uno nuevo desde el aviso
          </button>
          {assistant ? (
            <PromptHint
              prompt={`Armá el CV para mi postulación a ${application.company || '<empresa>'}`}
              onConnect={assistant.connected ? undefined : assistant.onConnect}
            />
          ) : null}
        </div>

        <details className="app-cv-record">
          <summary>¿Lo mandaste por fuera? Registrá qué CV enviaste</summary>
          <CvAttachmentPicker cvs={doc.cvs} value={application.attachment} onChange={onRecordSent} />
        </details>
      </div>
    </div>
  )
}
