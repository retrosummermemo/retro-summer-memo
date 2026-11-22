import { createApplication, defaultApplicationStatuses, moveApplication, saveDebrief, type ApplicationStatus } from '../domain/applications'
import { readCompanies } from '../domain/companies'
import {
  buildResume,
  createSeedDocument,
  type BulletNode,
  type Cv,
  type ResumeDocument,
  type ResumeEdge,
  type ResumeNode,
  type RoleNode,
} from '../domain/model'

/**
 * A document exercising every stored shape: two CVs, versions, knowledge, applications with history,
 * custom statuses and event kinds, and extra data on every kind of entity.
 */
export function sampleDocument(): ResumeDocument {
  const seed = createSeedDocument()
  const profile = {
    ...seed.profile,
    name: 'Ada Lovelace',
    fields: seed.profile.fields.map((field) => (field.id === 'email' ? { ...field, value: 'ada@example.com' } : field)),
    jobs: [{ id: 'job-1', company: 'Analytical Engines', roles: [{ id: 'job-1-r1', title: 'Engineer', location: 'London', start: '1842', end: '1843', extra: { stack: ['Notes'] } }] }],
    extra: { headline: 'First programmer' },
  }
  const person = { ...seed.nodes[0], data: profile } as ResumeNode
  const role: RoleNode = {
    id: 'role-1',
    type: 'role',
    position: { x: 48, y: 280 },
    data: { title: 'Engineer', company: 'Analytical Engines', location: 'London', start: '1842', end: '1843' },
  }
  const bullet: BulletNode = {
    id: 'bullet-1',
    type: 'bullet',
    position: { x: 400.5, y: 280.25 },
    data: { text: 'Wrote the first program', ability: '', skills: ['Algorithms'] },
  }
  // A section node: which entries of a section (projects here) this CV shows.
  const projects: ResumeNode = { id: 'section-1', type: 'section', position: { x: 48, y: 900 }, data: { sectionId: 'projects', entryIds: ['project-1'], experienceIds: [] } }
  const nodes: ResumeNode[] = [person, role, bullet, projects]
  const edges: ResumeEdge[] = [{ id: 'e-role-1-bullet-1', source: 'role-1', target: 'bullet-1' }]

  const seedCv = seed.cvs[0]
  const mainCv: Cv = {
    ...seedCv,
    title: 'Main CV',
    skillsFormat: 'comma',
    enabledSections: ['personal', 'experience', 'skills'],
    nodes,
    edges,
    versions: [
      ...seedCv.versions,
      { id: 'v-1', createdAt: '2026-01-02T03:04:05.000Z', snapshot: buildResume(nodes, edges, 'Poetical science.') },
    ],
  }
  const backendCv: Cv = {
    id: 'cv-2',
    title: 'Backend CV',
    position: 'Backend Engineer',
    company: 'Acme',
    posting: 'We build engines.',
    summary: '',
    templateId: 'sidebar',
    fontId: 'sans',
    fontSize: 11,
    lineHeight: 1.5,
    marginId: 'narrow',
    pageSize: 'a4',
    enabledSections: ['personal'],
    versions: [],
    nodes: [person],
    edges: [],
  }

  const statuses: ApplicationStatus[] = [
    ...defaultApplicationStatuses(),
    { id: 'take-home', name: 'Take home', color: '#123456', kind: 'active', extra: { description: 'Ejercicio en casa' } },
    { id: 'on-hold', name: 'En pausa', color: '#654321', kind: 'paused' },
  ]
  const acme = moveApplication(
    createApplication(
      {
        company: 'Acme',
        title: 'Backend Engineer',
        url: 'https://www.linkedin.com/jobs/view/4012345678/?refId=abc',
        posting: 'We need engines.',
        attachment: { kind: 'cv', cvId: 'seed-cv', versionId: 'v-1' },
        note: 'Referral from Babbage',
      },
      statuses,
      new Date('2026-03-01T10:00:00.000Z'),
    ),
    'hr-call',
    'Call on Monday',
    new Date('2026-03-05T10:00:00.000Z'),
  )
  const globex = createApplication({ company: 'Globex', title: 'Frontend Dev' }, statuses, new Date('2026-04-01T10:00:00.000Z'))
  const acmeDebriefed = saveDebrief(
    acme,
    {
      text: 'Fue bien, charla de 40 minutos',
      rating: 4,
      people: ['Laura (RRHH)'],
      asked: ['Por qué me quiero ir', 'Expectativa salarial'],
      said: ['90k'],
      unsaid: ['Que tengo otra oferta'],
      liked: ['Que lideré la migración'],
      concerns: [],
    },
    new Date('2026-03-06T15:00:00.000Z'),
  ).application
  const acmeWithExtras = {
    ...acmeDebriefed,
    extra: { salary: '90k', recruiter: 'Babbage' },
    events: [
      ...acmeDebriefed.events,
      { id: 'acme-interview', at: '2099-01-10T10:00:00.000Z', kind: 'interview', statusId: 'hr-call', text: 'Entrevista con el CTO', extra: { place: 'Zoom' } },
    ],
  }
  // Through the parser, so notes come in their stored order (newest first).
  const companies = readCompanies([
    {
      id: 'company-acme',
      name: 'Acme Inc.',
      website: 'acme.com',
      logo: '',
      about: 'Engines for everyone.',
      mission: 'Make engines simple.',
      vision: 'An engine in every home.',
      values: ['Ownership', 'Speed'],
      extra: { industry: 'Machinery', size: '200-500' },
      notes: [
        { id: 'note-layoff', kind: 'layoff', date: '2026-01', text: 'Cut 10% of staff', source: 'https://news.example.com/acme', addedAt: '2026-03-02T10:00:00.000Z' },
        { id: 'note-role', kind: 'role', date: '', text: 'Also hiring a Staff Engineer (Go)', source: '', addedAt: '2026-03-03T10:00:00.000Z', extra: { url: 'https://acme.com/jobs/2' } },
        { id: 'note-funding', kind: 'funding', date: '2026-02-15', text: 'Series B, 40M', source: 'Crunchbase', addedAt: '2026-03-02T11:00:00.000Z' },
      ],
    },
    { id: 'company-initech', name: 'Initech', website: '', logo: 'https://initech.example/logo.png', about: '', mission: '', vision: '', values: [], notes: [] },
  ])

  return {
    ...seed,
    profile,
    nodes,
    edges,
    // The Backend CV is the one made for the Acme application, copied from the main one.
    cvs: [mainCv, { ...backendCv, applicationId: acmeWithExtras.id, basedOn: mainCv.id, extra: { language: 'en' } }],
    activeCvId: mainCv.id,
    bank: seed.bank.map((item, index) => (index === 0 ? { ...item, entryId: 'job-1-r1', extra: { metric: '-40% latency' } } : item)),
    sections: seed.sections.map((section) =>
      section.id === 'experience'
        ? { ...section, name: 'Experiencia laboral', extra: { order: 1 } }
        : section.id === 'projects'
          ? { ...section, active: true, entries: [{ id: 'project-1', title: 'Difference Engine notes', subtitle: 'Author', location: '', start: '1842', end: '1843', description: '', url: '' }] }
          : section,
    ),
    knowledge: [
      { id: 'rest-api', level: 2 },
      { id: 'sql', level: 0 },
    ],
    applications: [acmeWithExtras, globex],
    applicationStatuses: statuses,
    companies,
  }
}

/**
 * What a store must give back: the document as stored, ignoring UI-only state (selection) and
 * the staleness of the open CV's copy of its graph.
 */
export function settled(document: ResumeDocument): unknown {
  const nodes = (list: ResumeNode[]) => list.map(({ selected: _selected, ...node }) => node)
  const edges = (list: ResumeEdge[]) => list.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }))
  return JSON.parse(
    JSON.stringify({
      ...document,
      knowledge: [...document.knowledge].sort((left, right) => left.id.localeCompare(right.id)),
      nodes: nodes(document.nodes),
      edges: edges(document.edges),
      cvs: document.cvs.map((cv) => {
        const live = cv.id === document.activeCvId
        return { ...cv, nodes: nodes(live ? document.nodes : cv.nodes), edges: edges(live ? document.edges : cv.edges) }
      }),
    }),
  )
}
