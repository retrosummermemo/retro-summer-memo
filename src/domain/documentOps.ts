/**
 * Whole-document operations shared by the app (UI) and the MCP server, so both change the
 * document the same way. Pure functions: ids and timestamps come in as arguments when callers
 * need to know them.
 */
import type { FontId } from './fonts'
import {
  applyProfile,
  buildResume,
  type Cv,
  type CvVersion,
  type Profile,
  type ResumeDocument,
} from './model'
import type { TemplateId } from './templates'

export type CvDraft = {
  title: string
  position: string
  company: string
  posting: string
  templateId: TemplateId
  fontId: FontId
  experienceIds: string[]
}

/** Sets the profile and copies it into every CV's person node. */
export function writeProfile(document: ResumeDocument, profile: Profile): ResumeDocument {
  return {
    ...document,
    profile,
    nodes: applyProfile(document.nodes, profile),
    cvs: document.cvs.map((cv) => ({ ...cv, nodes: applyProfile(cv.nodes, profile) })),
  }
}

/** CVs with the open CV's graph (kept at the document root while editing) written back into it. */
export function rememberGraph(document: ResumeDocument): Cv[] {
  return document.cvs.map((cv) => (cv.id === document.activeCvId ? { ...cv, nodes: document.nodes, edges: document.edges } : cv))
}

/** Opens `cvId` in the workspace: its graph moves to the document root. */
export function openCvGraph(document: ResumeDocument, cvId: string): ResumeDocument {
  if (document.activeCvId === cvId) return document
  const cvs = rememberGraph(document)
  const next = cvs.find((cv) => cv.id === cvId)
  if (!next) return document
  return { ...document, cvs, activeCvId: cvId, nodes: next.nodes, edges: next.edges }
}

/**
 * Removes a CV (applications that had it attached forget it); if it was open, the first remaining
 * one opens instead.
 */
export function deleteCv(document: ResumeDocument, cvId: string): ResumeDocument {
  const cvs = document.cvs.filter((cv) => cv.id !== cvId)
  const applications = document.applications.map((application) =>
    application.attachment?.kind === 'cv' && application.attachment.cvId === cvId ? { ...application, attachment: null } : application,
  )
  if (document.activeCvId !== cvId) return { ...document, cvs, applications }
  const next = cvs[0]
  return { ...document, cvs, applications, activeCvId: next?.id ?? '', nodes: next?.nodes ?? [], edges: next?.edges ?? [] }
}

/** "Generar": saves a new version of a CV built from its current graph. */
export function buildCvVersion(
  document: ResumeDocument,
  cvId: string,
  ids: { versionId?: string; now?: Date } = {},
): { document: ResumeDocument; versionId: string } {
  const cvs = rememberGraph(document)
  const cv = cvs.find((item) => item.id === cvId)
  if (!cv) throw new Error(`No CV with id ${cvId}`)
  const versionId = ids.versionId ?? crypto.randomUUID()
  const version: CvVersion = {
    id: versionId,
    createdAt: (ids.now ?? new Date()).toISOString(),
    snapshot: buildResume(cv.nodes, cv.edges, cv.summary, { sections: document.sections, bank: document.bank }),
  }
  return {
    document: { ...document, cvs: document.cvs.map((item) => (item.id === cvId ? { ...item, versions: [...item.versions, version] } : item)) },
    versionId,
  }
}
