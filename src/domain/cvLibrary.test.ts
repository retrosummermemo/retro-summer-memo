import { describe, expect, it } from 'vitest'
import { sampleDocument } from '../test/sample'
import {
  applicationCvs,
  applicationOf,
  assignCv,
  copiesByCv,
  copyCv,
  cvOfApplication,
  generalCvs,
  markSentVersion,
  shownCvOfApplication,
} from './cvLibrary'
import { deleteCv, openCvGraph } from './documentOps'

const now = new Date('2026-05-01T10:00:00.000Z')

function setup() {
  const document = sampleDocument()
  const acme = document.applications.find((application) => application.company === 'Acme')!
  const globex = document.applications.find((application) => application.company === 'Globex')!
  return { document, acme, globex }
}

describe('general and application CVs', () => {
  it('tells general CVs from the ones made for an application', () => {
    const { document, acme } = setup()
    expect(generalCvs(document).map((cv) => cv.title)).toEqual(['Main CV'])
    expect(applicationCvs(document)).toEqual([{ cv: expect.objectContaining({ id: 'cv-2' }), application: acme }])
    expect(cvOfApplication(document, acme.id)?.id).toBe('cv-2')
    expect(copiesByCv(document).get('seed-cv')).toBe(1)
  })

  it('counts a CV whose application is gone as general', () => {
    const { document, acme } = setup()
    const without = { ...document, applications: document.applications.filter((item) => item.id !== acme.id) }
    expect(applicationOf(document.cvs[1], without.applications)).toBeUndefined()
    expect(generalCvs(without).map((cv) => cv.id)).toEqual(['seed-cv', 'cv-2'])
  })

  it('shows the own CV of an application, else the one recorded as sent', () => {
    const { document, acme, globex } = setup()
    expect(shownCvOfApplication(document, acme)?.id).toBe('cv-2')
    expect(shownCvOfApplication(document, { ...globex, attachment: { kind: 'cv', cvId: 'seed-cv', versionId: '' } })?.id).toBe('seed-cv')
    expect(shownCvOfApplication(document, globex)).toBeUndefined()
  })
})

describe('copyCv', () => {
  it('copies a CV as a new general CV, without its versions', () => {
    const { document } = setup()
    const { document: next, cvId } = copyCv(document, 'seed-cv', { id: 'cv-react', title: 'CV React' })
    const copy = next.cvs.find((cv) => cv.id === cvId)!
    const original = document.cvs[0]
    expect(copy).toMatchObject({ title: 'CV React', basedOn: 'seed-cv', versions: [], templateId: original.templateId, summary: original.summary })
    expect(copy.applicationId).toBeUndefined()
    // The open CV's live graph is copied, not a stale one, and the copy does not share it.
    expect(copy.nodes.map((node) => node.id)).toEqual(document.nodes.map((node) => node.id))
    expect(copy.nodes[0]).not.toBe(document.nodes[0])
    expect(next.activeCvId).toBe(document.activeCvId)
    expect(copyCv(document, 'seed-cv').document.cvs.at(-1)?.title).toBe('Main CV (copia)')
  })

  it('makes the CV of an application from a general one, taking the posting from it', () => {
    const { document, globex } = setup()
    const posted = { ...document, applications: document.applications.map((item) => (item.id === globex.id ? { ...item, posting: 'React and TypeScript.' } : item)) }
    const { document: next, cvId } = copyCv(posted, 'seed-cv', { applicationId: globex.id, now })
    const copy = next.cvs.find((cv) => cv.id === cvId)!
    expect(copy).toMatchObject({ title: 'Main CV — Globex', applicationId: globex.id, basedOn: 'seed-cv', position: 'Frontend Dev', company: 'Globex', posting: 'React and TypeScript.' })
    expect(cvOfApplication(next, globex.id)?.id).toBe(cvId)
    expect(next.applications.find((item) => item.id === globex.id)?.attachment).toEqual({ kind: 'cv', cvId, versionId: '' })
    // The original stays as it was.
    expect(next.cvs.find((cv) => cv.id === 'seed-cv')).toEqual({ ...document.cvs[0], nodes: document.nodes, edges: document.edges })
  })

  it('keeps what an application already recorded as sent', () => {
    const { document, globex } = setup()
    const sent = markSentVersion(document, globex.id, 'seed-cv', 'v-1', now)
    const { document: next } = copyCv(sent, 'seed-cv', { applicationId: globex.id })
    expect(next.applications.find((item) => item.id === globex.id)?.attachment).toEqual({ kind: 'cv', cvId: 'seed-cv', versionId: 'v-1' })
  })

  it('gives an application one CV, and refuses unknown CVs or applications', () => {
    const { document, acme } = setup()
    expect(() => copyCv(document, 'seed-cv', { applicationId: acme.id })).toThrow(/ya tiene su CV \(Backend CV\)/)
    expect(() => copyCv(document, 'nope')).toThrow(/No existe el CV nope/)
    expect(() => copyCv(document, 'seed-cv', { applicationId: 'nope' })).toThrow(/No existe la postulación nope/)
  })

  it('copies a CV that is not open from its own graph', () => {
    const { document } = setup()
    const opened = openCvGraph(document, 'cv-2')
    const { document: next, cvId } = copyCv(opened, 'seed-cv')
    expect(next.cvs.find((cv) => cv.id === cvId)?.nodes.map((node) => node.id)).toEqual(document.nodes.map((node) => node.id))
  })
})

describe('assignCv and markSentVersion', () => {
  it('moves a CV to an application and back to the general ones', () => {
    const { document, globex, acme } = setup()
    const assigned = assignCv(document, 'seed-cv', globex.id, now)
    expect(cvOfApplication(assigned, globex.id)?.id).toBe('seed-cv')
    expect(() => assignCv(document, 'seed-cv', acme.id)).toThrow(/ya tiene su CV/)
    const general = assignCv(assigned, 'seed-cv', null)
    expect(general.cvs.find((cv) => cv.id === 'seed-cv')?.applicationId).toBeUndefined()
    expect(generalCvs(general).map((cv) => cv.id)).toContain('seed-cv')
  })

  it('pins the version sent, or the latest with an empty id', () => {
    const { document, acme } = setup()
    expect(markSentVersion(document, acme.id, 'seed-cv', 'v-1', now).applications.find((item) => item.id === acme.id)?.attachment).toEqual({
      kind: 'cv',
      cvId: 'seed-cv',
      versionId: 'v-1',
    })
    expect(() => markSentVersion(document, acme.id, 'seed-cv', 'v-9')).toThrow(/no tiene la versión v-9/)
  })

  it('forgets a deleted CV in the applications that had it', () => {
    const { document, acme } = setup()
    const next = deleteCv(document, 'seed-cv')
    expect(next.applications.find((item) => item.id === acme.id)?.attachment).toBeNull()
  })
})
