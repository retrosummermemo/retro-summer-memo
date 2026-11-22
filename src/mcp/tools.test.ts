/**
 * The MCP tools through the same HTTP handler the Edge Function uses, over an in-memory store.
 */
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import { createLocalStore } from '../adapters/local'
import { memoryStorage } from '../test/memoryStorage'
import { createEmptyDocument, type ResumeDocument } from '../domain/model'
import { sampleDocument } from '../test/sample'
import { registerTools } from './tools'

const now = new Date('2026-11-18T12:00:00.000Z')

async function setup(at: Date = now, document: ResumeDocument = sampleDocument()) {
  const store = createLocalStore(memoryStorage(), 'mcp-test')
  await store.save(document)
  let clock = at
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'test', version: '0' })
    registerTools(server, { store, now: () => clock })
    return server
  })
  /** Moves the server's clock, as if the user came back later. */
  const travel = (to: string) => {
    clock = new Date(to)
  }

  async function rpc(method: string, params: unknown) {
    const response = await handler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
    )
    const body = await response.text()
    return JSON.parse(body.split('\n').find((line) => line.startsWith('data:'))?.slice(5) ?? body)
  }

  /** Calls a tool: its JSON result, or `{ error }` when the tool reported one. */
  async function call(name: string, args: Record<string, unknown> = {}) {
    const message = await rpc('tools/call', { name, arguments: args })
    if (message.error) throw new Error(JSON.stringify(message.error))
    const text = message.result.content[0].text as string
    return message.result.isError ? { error: text } : text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text
  }

  return { store, document, rpc, call, travel, load: async () => (await store.load())! }
}

describe('MCP tools', () => {
  it('exposes the generic and the dedicated tools, and the everyday prompts', async () => {
    const { rpc } = await setup()
    const tools = (await rpc('tools/list', {})).result.tools.map((tool: { name: string }) => tool.name)
    expect(tools).toEqual(
      expect.arrayContaining(['describe_model', 'cv_guidelines', 'get_document', 'update_document', 'list_sections', 'save_entry', 'save_experience', 'build_cv', 'move_application']),
    )
    const prompts = (await rpc('prompts/list', {})).result.prompts.map((prompt: { name: string }) => prompt.name)
    expect(prompts).toEqual(['preparar-mi-resume', 'actualizar-mi-info', 'armar-cv', 'analizar-aviso', 'como-me-fue', 'investigar-empresa', 'preparar-entrevista', 'novedad'])
    expect(tools[0]).toBe('get_started')
    expect(tools).toEqual(expect.arrayContaining(['onboarding_guide', 'import_career', 'schedule_step']))
    expect(tools).toEqual(expect.arrayContaining(['get_company', 'save_company', 'save_company_note', 'delete_company_note', 'delete_company', 'save_debrief', 'delete_event']))
  })

  it('returns the document without graphs unless asked', async () => {
    const { call } = await setup()
    const view = await call('get_document', { include: ['cvs', 'profile'] })
    expect(Object.keys(view)).toEqual(['cvs', 'profile'])
    expect(view.cvs[0].nodes).toBeUndefined()
    expect(view.cvs[0].versions[0].snapshot).toBeUndefined()
    const full = await call('get_document', { include: ['cvs'], graphs: true })
    expect(full.cvs[0].nodes.length).toBeGreaterThan(0)
  })

  describe('update_document', () => {
    it('edits anything by id, fills new ids and copies the profile into every CV', async () => {
      const { call, load, document } = await setup()
      const acme = document.applications.find((application) => application.company === 'Acme')!
      const result = await call('update_document', {
        operations: [
          { op: 'replace', path: '/profile/name', value: 'Ada King' },
          { op: 'add', path: '/profile/jobs/-', value: { company: 'S64', roles: [{ title: 'Tech Lead', location: 'Madrid', start: '2023', end: 'Actualidad' }] } },
          { op: 'add', path: '/bank/-', value: { category: 'Leadership', text: 'Led a team of 6 engineers', skills: ['Leadership'] } },
          { op: 'replace', path: `/applications/[id=${acme.id}]/location`, value: 'Remoto' },
        ],
      })
      expect(result).toMatchObject({ saved: true, warnings: [] })
      expect(result.changes.map((change: { table: string }) => change.table)).toEqual(expect.arrayContaining(['profiles', 'experiences', 'applications']))

      const stored = await load()
      const job = stored.profile.jobs.find((item) => item.company === 'S64')!
      expect(job.id).toBeTruthy()
      expect(job.roles[0]).toMatchObject({ title: 'Tech Lead', start: '2023', end: 'Actualidad' })
      expect(job.roles[0].id).toBeTruthy()
      expect(stored.bank.find((item) => item.text === 'Led a team of 6 engineers')?.id).toBeTruthy()
      expect(stored.applications.find((item) => item.id === acme.id)?.location).toBe('Remoto')
      for (const cv of stored.cvs) {
        const person = (cv.id === stored.activeCvId ? stored.nodes : cv.nodes).find((node) => node.type === 'person')
        if (person) expect(person.data).toMatchObject({ name: 'Ada King' })
      }
    })

    it('previews with dry_run and applies nothing when an operation fails', async () => {
      const { call, load } = await setup()
      const preview = await call('update_document', { operations: [{ op: 'replace', path: '/profile/name', value: 'Preview' }], dry_run: true })
      expect(preview.saved).toBe(false)
      // The name lands in the profile and in every CV's person node.
      expect(preview.changes).toEqual(expect.arrayContaining([{ table: 'profiles', upserted: 1, deleted: 0 }]))
      const failed = await call('update_document', {
        operations: [
          { op: 'replace', path: '/profile/name', value: 'Half done' },
          { op: 'replace', path: '/applications/[id=nope]/company', value: 'X' },
        ],
      })
      expect(failed.error).toMatch(/Operation 2 .*no element with id "nope"/)
      expect((await load()).profile.name).toBe('Ada Lovelace')
    })

    it('accepts applications in statuses the pipeline does not have yet, creating them', async () => {
      const { call, load, document } = await setup()
      const globex = document.applications.find((application) => application.company === 'Globex')!
      const result = await call('update_document', {
        operations: [{ op: 'replace', path: `/applications/[id=${globex.id}]/statusId`, value: 'call-con-el-ceo' }],
      })
      expect(result.warnings).toEqual([])
      const stored = await load()
      expect(stored.applications.find((item) => item.id === globex.id)?.statusId).toBe('call-con-el-ceo')
      expect(stored.applicationStatuses.find((status) => status.id === 'call-con-el-ceo')).toMatchObject({ name: 'Call con el ceo' })
    })

    it('keeps any extra data the assistant adds to an entity', async () => {
      const { call, load, document } = await setup()
      const globex = document.applications.find((application) => application.company === 'Globex')!
      await call('update_document', {
        operations: [
          { op: 'add', path: `/applications/[id=${globex.id}]/extra`, value: { salary: '85k EUR', modality: 'remoto' } },
          { op: 'add', path: `/applications/[id=${globex.id}]/recruiter`, value: 'Laura' },
          {
            op: 'add',
            path: `/applications/[id=${globex.id}]/events/-`,
            value: { kind: 'interview', at: '2099-03-20T10:00:00.000Z', statusId: globex.statusId, text: 'Challenge técnico' },
          },
          { op: 'add', path: '/profile/jobs/0/roles/0/extra', value: { stack: ['Node.js', 'Azure'] } },
        ],
      })
      const stored = await load()
      const application = stored.applications.find((item) => item.id === globex.id)!
      expect(application.extra).toEqual({ salary: '85k EUR', modality: 'remoto', recruiter: 'Laura' })
      expect(application.events.at(-1)).toMatchObject({ kind: 'interview', text: 'Challenge técnico' })
      expect(stored.profile.jobs[0].roles[0].extra).toEqual({ stack: ['Node.js', 'Azure'] })
    })

    it('reports items the rules reject instead of saving them half-way', async () => {
      const { call } = await setup()
      const result = await call('update_document', { operations: [{ op: 'add', path: '/bank/-', value: { category: 'Empty' } }], dry_run: true })
      expect(result.warnings[0]).toMatch(/bank were invalid and dropped/)
    })
  })

  it('moves applications into new statuses by name', async () => {
    const { call, load, document } = await setup()
    const acme = document.applications.find((application) => application.company === 'Acme')!
    const moved = await call('move_application', { id: acme.id, status: 'Call con el CEO', note: 'El 20/3 a las 10' })
    expect(moved).toMatchObject({ status: 'Call con el CEO', created_status: 'Call con el CEO' })
    const stored = (await load()).applications.find((item) => item.id === acme.id)!
    expect(stored.events.some((event) => event.kind === 'note' && event.text === 'El 20/3 a las 10')).toBe(true)
    // What is scheduled for later stays after it in the history.
    expect(stored.events.at(-1)).toMatchObject({ kind: 'interview', extra: { place: 'Zoom' } })
  })

  it('fills sections, entries and experiences with one CRUD, then builds and reviews a CV', async () => {
    const { call, load, document } = await setup()
    const globex = document.applications.find((application) => application.company === 'Globex')!

    const role = await call('save_entry', { section: 'experiencia', title: 'Tech Lead', subtitle: 'S64 Capital', start: '2025', end: 'Actualidad' })
    expect(role.section_id).toBe('experience')
    const project = await call('save_entry', { section: 'Proyectos', title: 'Weball', subtitle: 'Founder', start: '2024', end: 'Actualidad' })
    expect(project.section_id).toBe('projects')
    const certification = await call('save_entry', { section: 'Certificaciones', title: 'AWS Solutions Architect', subtitle: 'Amazon', end: '2024' })

    const latency = await call('save_experience', { text: 'Reduje un 40% la latencia de órdenes con Redis', entry_id: role.entry_id, skills: ['Redis', 'Node.js'], level: 'profesional' })
    const team = await call('save_experience', { text: 'Responsable del equipo de backend', entry_id: role.entry_id, skills: ['Leadership'] })
    expect(team.follow_up).toEqual([expect.stringContaining('No measurable result')])
    expect(latency.follow_up).toEqual([])
    expect(role.follow_up).toEqual([expect.stringContaining(`entry_id ${role.entry_id}`)])
    const leagues = await call('save_experience', { text: 'Plataforma usada por 300 ligas', entry_id: project.entry_id, skills: ['React'] })
    const loose = await call('save_experience', { text: 'Mentoría a juniors' })
    expect(await call('save_experience', { text: 'X', entry_id: 'nope' })).toMatchObject({ error: expect.stringContaining('No existe la entrada') })

    const sections = await call('list_sections')
    expect(sections.find((section: { id: string }) => section.id === 'experience').entries.at(-1)).toMatchObject({ title: 'Tech Lead', subtitle: 'S64 Capital', experiences: 2 })
    const experiences = await call('list_experiences', { query: 'latencia' })
    expect(experiences[0]).toMatchObject({ where: 'Experiencia laboral: Tech Lead — S64 Capital', level: 'profesional' })

    const built = await call('build_cv', {
      title: 'Globex — Tech Lead',
      position: 'Tech Lead',
      company: 'Globex',
      posting: 'Buscamos Tech Lead con Node.js, Redis, Kubernetes y React.',
      summary: 'Tech Lead con 10 años en backend y producto.',
      experience_ids: [latency.experience_id, team.experience_id, leagues.experience_id, loose.experience_id],
      section_ids: ['Proyectos', 'Certificaciones'],
      application_id: globex.id,
    })
    expect(built.outline.roles.find((item: { company: string }) => item.company === 'S64 Capital')).toMatchObject({ experiences: 2 })
    // Sections asked for show all their entries: the sample's project plus Weball.
    expect(built.outline.sections).toEqual([
      { name: 'Personal projects', entries: 2 },
      { name: 'Certificaciones', entries: 1 },
    ])
    expect(built.outline.unplaced).toEqual([{ id: loose.experience_id, text: 'Mentoría a juniors' }])
    // The review points at what to fix: weak wording and keywords the bank backs but the CV lacks.
    const kinds = built.review.findings.map((finding: { kind: string }) => finding.kind)
    expect(kinds).toEqual(expect.arrayContaining(['wording', 'results']))
    expect(built.review.keywords.covered).toEqual(expect.arrayContaining(['Node.js', 'Redis', 'React']))
    expect(built.review.keywords.notInExperience).toContain('Kubernetes')

    // Built for the application: it is that application's own CV, shown as sent until a version is pinned.
    expect(built.application_id).toBe(globex.id)
    const stored = await load()
    expect(stored.cvs.find((cv) => cv.id === built.cv_id)?.applicationId).toBe(globex.id)
    expect(stored.applications.find((item) => item.id === globex.id)?.attachment).toEqual({ kind: 'cv', cvId: built.cv_id, versionId: '' })
    // Building for it again rebuilds that CV instead of making another one.
    const rebuilt = await call('build_cv', { experience_ids: [latency.experience_id], application_id: globex.id })
    expect(rebuilt.cv_id).toBe(built.cv_id)
    expect((await load()).cvs.filter((cv) => cv.applicationId === globex.id)).toHaveLength(1)
    expect(stored.cvs.find((cv) => cv.id === built.cv_id)?.enabledSections).toEqual(
      expect.arrayContaining(['experience', 'projects', stored.sections.find((section) => section.name === 'Certificaciones')!.id]),
    )
    expect(certification.entry_id).toBeTruthy()
  })

  it('keeps general CVs and one CV per application, copied from a general one', async () => {
    const { call, load, document } = await setup()
    const acme = document.applications.find((application) => application.company === 'Acme')!
    const globex = document.applications.find((application) => application.company === 'Globex')!

    const listed = await call('list_cvs')
    expect(listed.general).toEqual([expect.objectContaining({ cv_id: 'seed-cv', title: 'Main CV', application_copies: 1 })])
    expect(listed.for_applications).toEqual([
      expect.objectContaining({ cv_id: 'cv-2', application_id: acme.id, application: 'Acme — Backend Engineer', based_on: 'Main CV', step: 'Call con RRHH' }),
    ])

    // A new general CV per role, then a copy of it for an application.
    const react = await call('copy_cv', { cv_id: 'seed-cv', title: 'CV React' })
    expect(react).toMatchObject({ title: 'CV React', based_on: 'Main CV', general: true })
    expect(react.review.findings).toBeDefined()
    expect((await call('get_application', { id: globex.id })).own_cv).toMatchObject({ none: true })
    const forGlobex = await call('copy_cv', { cv_id: react.cv_id, application_id: globex.id })
    expect(forGlobex).toMatchObject({ title: 'CV React — Globex', based_on: 'CV React', application_id: globex.id })
    expect((await call('get_application', { id: globex.id })).own_cv).toMatchObject({ cv_id: forGlobex.cv_id, based_on: 'CV React', versions: 0 })
    expect(await call('copy_cv', { cv_id: react.cv_id, application_id: globex.id })).toMatchObject({ error: expect.stringContaining('ya tiene su CV') })

    // Back to a general CV, and into the application again.
    await call('update_cv', { cv_id: forGlobex.cv_id, application_id: null, title: 'CV React (Globex)' })
    let stored = await load()
    expect(stored.cvs.find((cv) => cv.id === forGlobex.cv_id)).toMatchObject({ title: 'CV React (Globex)', basedOn: react.cv_id })
    expect(stored.cvs.find((cv) => cv.id === forGlobex.cv_id)?.applicationId).toBeUndefined()
    await call('update_cv', { cv_id: forGlobex.cv_id, application_id: globex.id })
    stored = await load()
    expect(stored.cvs.find((cv) => cv.id === forGlobex.cv_id)?.applicationId).toBe(globex.id)

    // A general CV sent as it is: the application records that version, the CV stays general.
    const sent = await call('build_cv', { cv_id: 'seed-cv', experience_ids: [], application_id: acme.id })
    expect(sent.general).toBe(true)
    stored = await load()
    expect(stored.applications.find((item) => item.id === acme.id)?.attachment).toEqual({ kind: 'cv', cvId: 'seed-cv', versionId: sent.version_id })
    expect(stored.cvs.find((cv) => cv.id === 'seed-cv')?.applicationId).toBeUndefined()

    // Deleting a CV clears it from the applications that had it.
    await call('delete_cv', { id: 'seed-cv' })
    expect((await load()).applications.find((item) => item.id === acme.id)?.attachment).toBeNull()
  })

  it('deletes experiences and entries', async () => {
    const { call, load, document } = await setup()
    const [first, second] = document.bank
    expect(await call('delete_experiences', { experience_ids: [first.id, second.id] })).toEqual({ deleted: 2 })
    const stored = await load()
    expect(stored.bank.some((item) => item.id === first.id)).toBe(false)
    await call('delete_entry', { section: 'experience', entry_id: 'job-1-r1' })
    expect((await load()).profile.jobs).toEqual([])
  })

  it('deletes statuses re-homing their applications, and deletes applications', async () => {
    const { call, load, document } = await setup()
    const acme = document.applications.find((application) => application.company === 'Acme')!
    expect(await call('delete_status', { status: 'Call con RRHH', move_to: 'CV aceptado' })).toMatchObject({ moved: 1, to: 'CV aceptado' })
    let stored = await load()
    expect(stored.applicationStatuses.some((status) => status.id === 'hr-call')).toBe(false)
    expect(stored.applications.find((item) => item.id === acme.id)?.statusId).toBe('accepted')

    await call('delete_application', { id: acme.id })
    stored = await load()
    expect(stored.applications.some((item) => item.id === acme.id)).toBe(false)
  })

  describe('companies and debriefs', () => {
    it('saves research about a company and shows it with the applications and how each step went', async () => {
      const { call, load } = await setup()
      const saved = await call('save_company', {
        name: 'Globex Corp',
        website: 'globex.com',
        about: 'Energy for everyone',
        mission: 'Power the world',
        values: ['Ownership'],
        extra: { size: '1000+' },
      })
      expect(saved).toMatchObject({ created: true, name: 'Globex Corp', applications: 1 })

      const note = await call('save_company_note', { company: 'globex', kind: 'layoff', date: '2026-02', text: 'Cut 5%', source: 'https://news.test/globex' })
      expect(note.company_id).toBe(saved.company_id)
      expect(await call('save_company_note', { company: 'Globex', text: 'x', date: 'febrero' })).toMatchObject({ error: expect.stringContaining('YYYY') })

      const globex = (await load()).applications.find((application) => application.company === 'Globex')!
      const debrief = await call('save_debrief', {
        application_id: globex.id,
        at: '2026-11-17',
        how_it_went: 'Bien',
        rating: 4,
        asked: ['Por qué Globex'],
        unsaid: ['Que tengo otra oferta'],
      })
      expect(debrief).toMatchObject({ step: 'CV enviado', at: '2026-11-17T12:00:00.000Z', how_it_went: 'Bien', rating: 4, asked: ['Por qué Globex'] })
      expect(debrief.said).toBeUndefined()

      const view = await call('get_company', { company: 'GLOBEX' })
      expect(view).toMatchObject({
        company_id: saved.company_id,
        name: 'Globex Corp',
        mission: 'Power the world',
        values: ['Ownership'],
        extra: { size: '1000+' },
        notes: [{ note_id: note.note_id, kind: 'layoff', date: '2026-02', text: 'Cut 5%', source: 'https://news.test/globex' }],
        applications: [{ id: globex.id, debriefs: [{ debrief_id: debrief.debrief_id, unsaid: ['Que tengo otra oferta'] }] }],
      })

      const application = await call('get_application', { id: globex.id })
      expect(application.company).toMatchObject({ saved: true, company_id: saved.company_id, notes: 1 })
      expect(application.history.at(-1)).toMatchObject({ kind: 'debrief', debrief_id: debrief.debrief_id, rating: 4 })

      // Only the fields sent change.
      await call('save_debrief', { application_id: globex.id, debrief_id: debrief.debrief_id, said: ['Que me gusta el producto'] })
      const after = (await load()).applications.find((item) => item.id === globex.id)!.events.find((event) => event.id === debrief.debrief_id)!
      expect(after.text).toBe('Bien')
      expect(after.debrief).toMatchObject({ rating: 4, said: ['Que me gusta el producto'], unsaid: ['Que tengo otra oferta'] })

      expect(await call('delete_event', { application_id: globex.id, event_id: debrief.debrief_id })).toEqual({ deleted: debrief.debrief_id })
      expect(await call('delete_company_note', { company: saved.company_id, note_id: note.note_id })).toEqual({ deleted: note.note_id })
      expect(await call('delete_company', { company: 'Globex' })).toEqual({ deleted: 'Globex Corp', notes: 0 })
      expect((await load()).companies.map((company) => company.name)).toEqual(['Acme Inc.', 'Initech'])
    })

    it("takes a day as its midday, and today as now so it does not look scheduled", async () => {
      const { call, load } = await setup()
      const globex = (await load()).applications.find((application) => application.company === 'Globex')!
      // now is 2026-11-18T12:00Z: today's midday is not ahead; at 08:00Z it would be.
      const today = await call('save_debrief', { application_id: globex.id, at: '2026-11-18', how_it_went: 'x' })
      expect(today.at).toBe('2026-11-18T12:00:00.000Z')
      const past = await call('save_debrief', { application_id: globex.id, at: '2026-11-02', how_it_went: 'y' })
      expect(past.at).toBe('2026-11-02T12:00:00.000Z')
      expect(await call('save_debrief', { application_id: globex.id, at: 'ayer' })).toMatchObject({ error: expect.stringContaining('YYYY-MM-DD') })

      const early = await setup(new Date('2026-11-18T08:00:00.000Z'))
      const id = (await early.load()).applications.find((application) => application.company === 'Globex')!.id
      expect((await early.call('save_debrief', { application_id: id, at: '2026-11-18', how_it_went: 'x' })).at).toBe('2026-11-18T08:00:00.000Z')
    })

    it('tells what is known about the company when an application is created, and refuses unknown steps', async () => {
      const { call, load } = await setup()
      const created = await call('create_application', { stage: 'applied', company: 'ACME', title: 'Staff Engineer', confirm_duplicate: true })
      expect(created.company).toMatchObject({ saved: true, company_id: 'company-acme', notes: 3 })
      const fresh = await call('create_application', { stage: 'applied', company: 'Hooli', title: 'Dev' })
      expect(fresh.company).toMatchObject({ saved: false })
      expect(await call('get_company', { company: 'Hooli' })).toMatchObject({ company_id: null, saved: false, applications: [{ company: 'Hooli' }] })
      expect(await call('get_company', { company: 'Nadie' })).toMatchObject({ error: expect.stringContaining('No hay nada') })

      const hooli = (await load()).applications.find((application) => application.company === 'Hooli')!
      expect(await call('save_debrief', { application_id: hooli.id, stage: 'Call con el CEO', how_it_went: 'x' })).toMatchObject({
        error: expect.stringContaining('No existe el estado'),
      })
      expect(await call('delete_event', { application_id: hooli.id, event_id: hooli.events[0].id })).toMatchObject({ error: expect.stringContaining('no se borran') })
    })

    it('renames the applications along with the company', async () => {
      const { call, load } = await setup()
      await call('save_company', { company_id: 'company-acme', name: 'Acme Engines' })
      expect((await load()).applications.map((application) => application.company)).toEqual(['Acme Engines', 'Globex'])
      expect(await call('save_company', { company_id: 'company-acme', name: 'Initech' })).toMatchObject({ error: expect.stringContaining('Ya existe') })
    })

    it('edits companies and their notes through update_document too', async () => {
      const { call, load } = await setup()
      const result = await call('update_document', {
        operations: [{ op: 'add', path: '/companies/[id=company-initech]/notes/-', value: { kind: 'hiring', text: 'Hiring 20 engineers' } }],
      })
      expect(result.changes).toEqual(expect.arrayContaining([{ table: 'company_notes', upserted: 1, deleted: 0 }]))
      const [note] = (await load()).companies.find((company) => company.id === 'company-initech')!.notes
      expect(note).toMatchObject({ kind: 'hiring', text: 'Hiring 20 engineers', addedAt: now.toISOString() })
      expect(note.id).toBeTruthy()
    })
  })

  describe('the assistant drives the conversation', () => {
    it('starts an empty account with the onboarding, and a used one with its gaps and pipeline', async () => {
      const empty = await setup(now, createEmptyDocument())
      const fresh = await empty.call('get_started')
      expect(fresh).toMatchObject({ today: now.toISOString(), user: null, setup: { mode: 'empty' }, onboarding_guide: expect.stringContaining('import_career') })
      expect(fresh.start_with[0]).toMatch(/onboarding/)

      const { call } = await setup()
      const started = await call('get_started')
      // One role with one achievement placed under it: enough to build CVs, with gaps left to polish.
      expect(started).toMatchObject({ user: 'Ada Lovelace', setup: { mode: 'ready' }, applications: { total: 2, open: 2 } })
      expect(started.onboarding_guide).toBeUndefined()
      expect(started.setup.done).toEqual(expect.arrayContaining(['name', 'email', 'roles', 'achievements', 'roles_without_achievements']))
      expect(started.setup.missing.map((item: { key: string }) => item.key)).toEqual(expect.arrayContaining(['phone', 'linkedin']))
      expect(started.pipeline[0]).toEqual({ step: 'Analizando propuesta', kind: 'considering' })
      expect(started.agenda.upcoming).toEqual([expect.objectContaining({ company: 'Acme', what: 'Entrevista con el CTO', event_id: 'acme-interview' })])
      expect(started.start_with.length).toBeGreaterThan(0)
      expect(await call('onboarding_guide')).toMatch(/role by role/)
    })

    it('saves a bare posting as "Analizando propuesta" with how it fits, and records the day once the user applies', async () => {
      const { call, load } = await setup()
      const imported = await call('import_career', {
        entries: [{ section: 'experience', title: 'Engineer', subtitle: 'Analytical Engines', start: '1842', experiences: [{ text: 'Reduje un 40% la latencia con Redis', skills: ['Redis', 'Node.js'] }] }],
      })
      expect(imported.entries).toEqual([expect.objectContaining({ entry_id: 'job-1-r1', created: false })])

      const posting = 'Initech busca Backend Engineer: Node.js, Redis y Kubernetes. Remoto.'
      const weighing = await call('create_application', { stage: 'considering', company: 'Initech', title: 'Backend Engineer', url: 'https://jobs.lever.co/initech/abc', posting })
      expect(weighing).toMatchObject({
        created: true,
        application: { status: 'Analizando propuesta', applied_on: null },
        fit: { backed_by_experience: expect.arrayContaining(['Node.js', 'Redis']), not_in_experience: ['Kubernetes'], closest_experiences: [{ text: 'Reduje un 40% la latencia con Redis' }] },
        company: { saved: true },
      })
      expect(weighing.created_status).toBeUndefined()
      expect(weighing.follow_up.join(' ')).toMatch(/short take.*apply.*discard/s)

      const applied = await call('move_application', { id: weighing.application.id, status: 'CV enviado', applied_on: '2026-11-17' })
      expect(applied).toMatchObject({ status: 'CV enviado', applied_on: '2026-11-17', applied_on_recorded: '2026-11-17' })
      expect(applied.follow_up.join(' ')).toMatch(/They applied/)
      expect((await load()).applications.find((item) => item.id === weighing.application.id)?.appliedOn).toBe('2026-11-17')
    })

    it('adds "Analizando propuesta" to pipelines saved before it existed', async () => {
      const old = sampleDocument()
      const { call, load } = await setup(now, { ...old, applicationStatuses: old.applicationStatuses.filter((status) => status.kind !== 'considering') })
      const weighing = await call('create_application', { stage: 'considering', company: 'Hooli', title: 'Dev' })
      expect(weighing).toMatchObject({ created_status: 'Analizando propuesta', application: { status: 'Analizando propuesta' } })
      expect(weighing.fit).toBeUndefined()
      expect(weighing.follow_up[0]).toMatch(/No posting text/)
      expect((await load()).applicationStatuses[0]).toMatchObject({ name: 'Analizando propuesta', kind: 'considering' })
    })

    it('puts "mañana tengo call con RRHH" on the calendar, then asks how it went once it is past', async () => {
      const { call, document, travel } = await setup()
      const globex = document.applications.find((application) => application.company === 'Globex')!
      const scheduled = await call('schedule_step', {
        application_id: globex.id,
        what: 'Call con Laura (RRHH)',
        at: '2026-11-19T15:00:00-03:00',
        kind: 'call',
        move_to: 'call con rrhh',
      })
      expect(scheduled).toMatchObject({ at: '2026-11-19T18:00:00.000Z', kind: 'call', step: 'Call con RRHH', application: { status: 'Call con RRHH' } })
      expect(scheduled.follow_up).toHaveLength(3)

      const before = await call('get_started')
      expect(before.agenda.upcoming[0]).toMatchObject({ company: 'Globex', what: 'Call con Laura (RRHH)', step: 'Call con RRHH' })
      expect(before.start_with.join(' ')).toMatch(/Globex — "Call con Laura \(RRHH\)" on 2026-11-19 18:00/)

      const moved = await call('schedule_step', { application_id: globex.id, event_id: scheduled.event_id, what: 'Call con Laura (RRHH)', at: '2026-11-20T15:00:00-03:00', kind: 'call' })
      expect(moved).toMatchObject({ event_id: scheduled.event_id, at: '2026-11-20T18:00:00.000Z' })

      travel('2026-11-21T12:00:00.000Z')
      const after = await call('get_started')
      expect(after.agenda.to_debrief).toEqual([expect.objectContaining({ company: 'Globex', event_id: scheduled.event_id, days: 0 })])
      expect(after.start_with[0]).toMatch(/Globex.*no debrief.*save_debrief/)
      const told = await call('save_debrief', { application_id: globex.id, how_it_went: 'Bien, 30 minutos' })
      expect(told.follow_up).toEqual([expect.stringContaining('what they were asked'), expect.stringContaining('1 to 5'), expect.stringContaining('move_application')])
      expect((await call('get_started')).agenda.to_debrief).toEqual([])
    })

    it('takes a day without a time as that day, later today when its midday passed', async () => {
      const { call, document } = await setup(new Date('2026-11-18T16:00:00.000Z'))
      const globex = document.applications.find((application) => application.company === 'Globex')!
      expect((await call('schedule_step', { application_id: globex.id, what: 'Entrega', at: '2026-11-18', kind: 'challenge' })).at).toBe('2026-11-18T23:59:00.000Z')
      expect((await call('schedule_step', { application_id: globex.id, what: 'Entrega 2', at: '2026-11-25' })).at).toBe('2026-11-25T12:00:00.000Z')
      expect(await call('schedule_step', { application_id: globex.id, what: 'x', at: '2026-11-25', kind: 'debrief' })).toMatchObject({ error: expect.stringContaining('debrief') })
    })

    it('imports a whole CV in one call, says what is still missing, and never duplicates', async () => {
      const { call } = await setup(now, createEmptyDocument())
      const cv = {
        profile: { name: 'Guido', fields: [{ label: 'Email', value: 'guido@example.com' }] },
        entries: [
          { section: 'experience', title: 'Tech Lead', subtitle: 'Weball', start: '2022', experiences: [{ text: 'Lideré un equipo de 6 personas', level: 'profesional' }] },
          { section: 'experience', title: 'Developer', subtitle: 'Globex', start: '2019' },
        ],
      }
      const first = await call('import_career', cv)
      expect(first).toMatchObject({ profile_updated: true, skipped_duplicates: [] })
      expect(first.experiences_added).toHaveLength(1)
      expect(first.follow_up.join(' ')).toMatch(/No achievements at Developer — Globex/)
      const again = await call('import_career', cv)
      expect(again.entries.every((entry: { created: boolean }) => !entry.created)).toBe(true)
      expect(again.skipped_duplicates).toEqual(['Lideré un equipo de 6 personas'])
      const profile = await call('update_profile', { fields: [{ label: 'Teléfono', value: '+54 11 5555 5555' }] })
      expect(profile.follow_up[0]).toMatch(/location, linkedin/)
    })
  })
})
