/**
 * The user's CVs by use. General CVs are one per profile or role ("CV React", "CV Arquitecto");
 * each application can have its own CV, a copy of one of them tailored to that posting. Copies are
 * independent: changing the original later does not touch them. Pure functions only.
 */
import { updateApplication, type Application } from './applications'
import { rememberGraph } from './documentOps'
import type { Cv, ResumeDocument } from './model'

/** The application a CV was made for; undefined for a general CV (or when that application is gone). */
export function applicationOf(cv: Cv, applications: Application[]): Application | undefined {
  return cv.applicationId ? applications.find((application) => application.id === cv.applicationId) : undefined
}

/** CVs that belong to no application: the ones the user keeps per role or profile. */
export function generalCvs(document: Pick<ResumeDocument, 'cvs' | 'applications'>): Cv[] {
  return document.cvs.filter((cv) => !applicationOf(cv, document.applications))
}

/** CVs made for an application, newest application activity first. */
export function applicationCvs(document: Pick<ResumeDocument, 'cvs' | 'applications'>): { cv: Cv; application: Application }[] {
  return document.cvs
    .flatMap((cv) => {
      const application = applicationOf(cv, document.applications)
      return application ? [{ cv, application }] : []
    })
    .sort((left, right) => right.application.updatedAt.localeCompare(left.application.updatedAt))
}

/** The CV made for an application, if it has one. */
export function cvOfApplication(document: Pick<ResumeDocument, 'cvs'>, applicationId: string): Cv | undefined {
  return document.cvs.find((cv) => cv.applicationId === applicationId)
}

/** The CV an application shows: its own, else the one it says was sent. */
export function shownCvOfApplication(document: Pick<ResumeDocument, 'cvs'>, application: Application): Cv | undefined {
  const attachment = application.attachment
  return cvOfApplication(document, application.id) ?? (attachment?.kind === 'cv' ? document.cvs.find((cv) => cv.id === attachment.cvId) : undefined)
}

/** How many application CVs were copied from each CV. */
export function copiesByCv(document: Pick<ResumeDocument, 'cvs' | 'applications'>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const { cv } of applicationCvs(document)) {
    if (cv.basedOn) counts.set(cv.basedOn, (counts.get(cv.basedOn) ?? 0) + 1)
  }
  return counts
}

export type CopyCvOptions = {
  id?: string
  /** Name of the copy. Default: the original's, with the company for an application, or "(copia)". */
  title?: string
  /** Make it the CV of this application: it takes the posting, role and company from it. */
  applicationId?: string
  now?: Date
}

/**
 * Copies a CV: a new general CV, or the CV of an application. The copy starts with no versions
 * (versions are what gets sent); its content, look and sections are the original's.
 */
export function copyCv(document: ResumeDocument, sourceId: string, options: CopyCvOptions = {}): { document: ResumeDocument; cvId: string } {
  const cvs = rememberGraph(document)
  const source = cvs.find((cv) => cv.id === sourceId)
  if (!source) throw new Error(`No existe el CV ${sourceId}.`)
  const application = options.applicationId ? findApplication(document, options.applicationId) : undefined
  if (application) assertWithoutCv(document, application)
  const id = options.id ?? crypto.randomUUID()
  const sourceTitle = source.title.trim() || 'Sin título'
  const title =
    options.title?.trim() ||
    (application ? [sourceTitle, application.company.trim()].filter(Boolean).join(' — ') : `${sourceTitle} (copia)`)
  const copy: Cv = {
    ...structuredClone(source),
    id,
    title,
    versions: [],
    nodes: structuredClone(source.nodes).map((node) => ({ ...node, selected: false })),
    edges: structuredClone(source.edges),
    basedOn: source.id,
  }
  delete copy.applicationId
  if (application) {
    copy.applicationId = application.id
    copy.position = application.title.trim() || source.position
    copy.company = application.company.trim() || source.company
    copy.posting = application.posting.trim() ? application.posting : source.posting
  }
  const next: ResumeDocument = { ...document, cvs: [...cvs, copy] }
  return { document: application ? attachOwnCv(next, application.id, id, options.now) : next, cvId: id }
}

/**
 * Makes a CV the CV of an application (it leaves its previous one, if it was another's), or a
 * general CV again with `applicationId` null.
 */
export function assignCv(document: ResumeDocument, cvId: string, applicationId: string | null, now?: Date): ResumeDocument {
  const cv = document.cvs.find((item) => item.id === cvId)
  if (!cv) throw new Error(`No existe el CV ${cvId}.`)
  if (applicationId === null) {
    return { ...document, cvs: document.cvs.map((item) => (item.id === cvId ? withoutApplication(item) : item)) }
  }
  const application = findApplication(document, applicationId)
  if (cv.applicationId !== application.id) assertWithoutCv(document, application)
  const next = { ...document, cvs: document.cvs.map((item) => (item.id === cvId ? { ...item, applicationId: application.id } : item)) }
  return attachOwnCv(next, application.id, cvId, now)
}

/** Records the version of its CV an application was sent ('' = whatever the latest one is). */
export function markSentVersion(document: ResumeDocument, applicationId: string, cvId: string, versionId: string, now?: Date): ResumeDocument {
  const application = findApplication(document, applicationId)
  const cv = document.cvs.find((item) => item.id === cvId)
  if (!cv) throw new Error(`No existe el CV ${cvId}.`)
  if (versionId && !cv.versions.some((version) => version.id === versionId)) throw new Error(`El CV ${cv.title} no tiene la versión ${versionId}.`)
  return {
    ...document,
    applications: document.applications.map((item) =>
      item.id === application.id ? updateApplication(item, { attachment: { kind: 'cv', cvId, versionId } }, now) : item,
    ),
  }
}

function withoutApplication(cv: Cv): Cv {
  const next = { ...cv }
  delete next.applicationId
  return next
}

function findApplication(document: Pick<ResumeDocument, 'applications'>, id: string): Application {
  const application = document.applications.find((item) => item.id === id)
  if (!application) throw new Error(`No existe la postulación ${id}.`)
  return application
}

function assertWithoutCv(document: Pick<ResumeDocument, 'cvs'>, application: Application) {
  const current = cvOfApplication(document, application.id)
  if (current) throw new Error(`La postulación a ${application.company || application.title} ya tiene su CV (${current.title}).`)
}

/**
 * Its own CV is what the application shows as sent, until a version is pinned. What was already
 * recorded as sent (a pinned version of another CV, a file) stays.
 */
function attachOwnCv(document: ResumeDocument, applicationId: string, cvId: string, now?: Date): ResumeDocument {
  return {
    ...document,
    applications: document.applications.map((application) => {
      if (application.id !== applicationId) return application
      const attachment = application.attachment
      if (attachment?.kind === 'cv' && (attachment.cvId === cvId || attachment.versionId !== '')) return application
      if (attachment?.kind === 'file') return application
      return updateApplication(application, { attachment: { kind: 'cv', cvId, versionId: '' } }, now)
    }),
  }
}
