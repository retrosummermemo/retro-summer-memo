/**
 * MCP tools over the user's document. They depend only on the DocumentStore port: the Edge
 * Function passes a Supabase store scoped to the signed-in user, tests pass an in-memory one.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import {
  STALE_DAYS,
  companyFromUrl,
  daysSince,
  defaultQuery,
  filterApplications,
  fold,
  lastActivity,
} from '../domain/applicationFilters'
import {
  addApplicationNote,
  consideringStatus,
  createApplication,
  debriefLists,
  findDuplicates,
  findOrCreateStatus,
  moveApplication,
  removeApplicationNote,
  removeStatus,
  saveDebrief,
  scheduleEvent,
  updateApplication,
  type Application,
  type ApplicationEvent,
  type ApplicationStatus,
  type Debrief,
  type DuplicateMatch,
} from '../domain/applications'
import {
  applicationsTo,
  companyNoteKinds,
  companyOf,
  deleteCompany,
  deleteCompanyNote,
  findCompany,
  saveCompany,
  saveCompanyNote,
  type Company,
} from '../domain/companies'
import {
  deleteEntry,
  deleteExperiences,
  deleteSection,
  importCareer,
  saveEntry,
  saveExperience,
  saveSection,
  sectionsView,
  setLevels,
  updateProfileInfo,
} from '../domain/content'
import { buildCv } from '../domain/cvBuilder'
import { applicationCvs, assignCv, copiesByCv, copyCv, cvOfApplication, generalCvs } from '../domain/cvLibrary'
import { buildCvVersion, deleteCv, rememberGraph } from '../domain/documentOps'
import { buildResume, type Cv, type ResumeDocument } from '../domain/model'
import type { DocumentStore } from '../ports/documentStore'
import { documentView, patchDocument, type EditableDocument } from './document'
import { APP_URL, CV_GUIDE, MODEL_GUIDE, ONBOARDING_GUIDE } from './guide'
import { hasResult, postingFit, reviewCv } from '../domain/cvReview'
import { agenda as buildAgenda, setupStatus, type AgendaItem } from '../domain/assistantBrief'
import { afterCreate, afterDebrief, afterEntry, afterExperience, afterMove, afterSchedule, setupGaps, startingPoints } from './followUps'
import { DEFAULT_ACCENT, accentColors, fontIds } from '../domain/fonts'
import { templateIds } from '../domain/templates'
import type { PatchOperation } from './jsonPatch'

export type ToolContext = { store: DocumentStore; now?: () => Date }

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
const levelLabel: Record<number, string> = { 0: 'sin experiencia', 1: 'personal', 2: 'profesional' }
const levelValue = { 'sin experiencia': 0, personal: 1, profesional: 2 } as const
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá YYYY-MM-DD')
const noteDate = z.union([z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'Usá YYYY-MM-DD, YYYY-MM o YYYY'), z.literal('')])
const momentInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/, 'Usá YYYY-MM-DD o una fecha ISO')
const listInput = z.array(z.string())
const knownNoteKinds = companyNoteKinds.map((item) => `${item.kind} (${item.hint.toLowerCase()})`).join(', ')

/**
 * When something happened: an ISO moment, or a day (`yyyy-mm-dd`) taken as its midday UTC so it
 * shows as that day anywhere. Today's midday may still be ahead, which would make it look
 * scheduled: then it is now.
 */
function pastMoment(value: string, now: Date): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const time = Date.parse(day ? `${value}T12:00:00.000Z` : value)
  if (Number.isNaN(time)) throw new Error(`Fecha inválida: ${value}`)
  if (day && time > now.getTime() && value === now.toISOString().slice(0, 10)) return now.toISOString()
  return new Date(time).toISOString()
}

/**
 * When something scheduled happens: an ISO moment, or a day taken as its midday UTC (that day
 * anywhere). A day that is today and whose midday already passed is taken as later today.
 */
function scheduledMoment(value: string, now: Date): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const time = Date.parse(day ? `${value}T12:00:00.000Z` : value)
  if (Number.isNaN(time)) throw new Error(`Fecha inválida: ${value}`)
  if (day && time <= now.getTime() && value === now.toISOString().slice(0, 10)) return `${value}T23:59:00.000Z`
  return new Date(time).toISOString()
}

function agendaView(item: AgendaItem) {
  return {
    application_id: item.applicationId,
    company: item.company,
    title: item.title,
    step: item.status,
    ...(item.eventId ? { event_id: item.eventId, at: item.at, kind: item.kind, what: item.text || undefined } : {}),
    ...(item.days !== undefined ? { days: item.days } : {}),
  }
}

const contactKeys = new Set(['name', 'email', 'phone', 'location', 'linkedin'])

/** The debrief without empty parts, for compact answers. */
function debriefView(event: ApplicationEvent, statusById: Map<string, ApplicationStatus>) {
  const debrief: Partial<Debrief> = event.debrief ?? {}
  return {
    debrief_id: event.id,
    step: statusById.get(event.statusId)?.name ?? event.statusId,
    at: event.at,
    how_it_went: event.text || undefined,
    rating: debrief.rating ?? undefined,
    ...Object.fromEntries(debriefLists.flatMap((key) => (debrief[key]?.length ? [[key, debrief[key]]] : []))),
  }
}

function companyView(company: Company) {
  return {
    company_id: company.id,
    name: company.name,
    website: company.website || undefined,
    logo: company.logo || undefined,
    about: company.about || undefined,
    mission: company.mission || undefined,
    vision: company.vision || undefined,
    values: company.values.length > 0 ? company.values : undefined,
    extra: company.extra,
    notes: company.notes.map((note) => ({
      note_id: note.id,
      kind: note.kind,
      date: note.date || undefined,
      text: note.text,
      source: note.source || undefined,
      ...(note.extra ? { extra: note.extra } : {}),
    })),
  }
}

const documentParts = [
  'profile',
  'bank',
  'knowledge',
  'sections',
  'roleGraphs',
  'cvs',
  'activeCvId',
  'applications',
  'applicationStatuses',
  'companies',
] as const satisfies readonly (keyof EditableDocument)[]

const patchOperation = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
  path: z.string().describe('JSON Pointer, e.g. /profile/jobs/[id=abc]/roles/-'),
  from: z.string().optional().describe('Source path, for move and copy'),
  value: z.unknown().optional().describe('For add, replace and test'),
})

function resolveStatus(statuses: ApplicationStatus[], value: string): ApplicationStatus {
  const wanted = fold(value.trim())
  const status = statuses.find((item) => item.id === value || fold(item.name) === wanted)
  if (!status) throw new Error(`No existe el estado "${value}". Estados: ${statuses.map((item) => item.name).join(', ')}.`)
  return status
}

function findApplication(document: ResumeDocument, id: string): Application {
  const application = document.applications.find((item) => item.id === id)
  if (!application) throw new Error(`No encontré la postulación ${id}. Usá search_applications para obtener el id.`)
  return application
}

function summary(application: Application, statusById: Map<string, ApplicationStatus>, now: Date) {
  const activity = lastActivity(application)
  return {
    id: application.id,
    company: application.company,
    title: application.title,
    status: statusById.get(application.statusId)?.name ?? application.statusId,
    // Postings still being weighed were not applied to: no date until they move on.
    applied_on: application.appliedOn || (statusById.get(application.statusId)?.kind === 'considering' ? null : application.createdAt.slice(0, 10)),
    last_activity: activity,
    days_without_activity: daysSince(activity, now),
    location: application.location || undefined,
    url: application.url || undefined,
  }
}

function duplicateReport(matches: DuplicateMatch[], statusById: Map<string, ApplicationStatus>, now: Date) {
  return matches.map(({ application, reason, similarity }) => ({
    reason, // same-posting | same-role | same-company
    similarity: Math.round(similarity * 100) / 100,
    ...summary(application, statusById, now),
    status_kind: statusById.get(application.statusId)?.kind,
  }))
}

/** What get_application and create_application say about the company. */
function companyBrief(document: ResumeDocument, application: Application) {
  const company = companyOf(document.companies, application)
  if (!company) return { saved: false, hint: 'Nothing saved about this company yet: research it and save it with save_company and save_company_note.' }
  return { saved: true, company_id: company.id, name: company.name, about: company.about || undefined, notes: company.notes.length, more: 'get_company' }
}

function cvAttachment(document: ResumeDocument, attachment: Application['attachment']) {
  if (!attachment) return null
  if (attachment.kind === 'file') return { kind: 'file', name: attachment.name }
  const cv = document.cvs.find((item) => item.id === attachment.cvId)
  if (!cv) return { kind: 'cv', missing: true }
  const index = cv.versions.findIndex((version) => version.id === attachment.versionId)
  return { kind: 'cv', cv_id: cv.id, title: cv.title, version: index >= 0 ? `v${index + 1} (${cv.versions[index].createdAt})` : 'latest' }
}

/** The CV made for an application, or how to make one. */
function ownCvView(document: ResumeDocument, application: Application) {
  const cv = cvOfApplication(document, application.id)
  if (!cv) {
    return {
      none: true,
      hint: 'No CV made for this application yet: copy_cv from one of the general CVs (list_cvs) with this application_id, or build_cv with application_id.',
    }
  }
  return { cv_id: cv.id, title: cv.title, based_on: baseTitle(document, cv), versions: cv.versions.length }
}

function baseTitle(document: ResumeDocument, cv: Cv): string | undefined {
  if (!cv.basedOn) return undefined
  return document.cvs.find((item) => item.id === cv.basedOn)?.title ?? 'a deleted CV'
}

/** A CV as it prints now (its draft), built from its current content. */
function draftOf(document: ResumeDocument, cvId: string) {
  const cv = rememberGraph(document).find((item) => item.id === cvId)!
  return { cv, snapshot: buildResume(cv.nodes, cv.edges, cv.summary, { sections: document.sections, bank: document.bank }) }
}

export function registerTools(server: McpServer, { store, now: clock = () => new Date() }: ToolContext) {
  async function open(): Promise<ResumeDocument> {
    const document = await store.load()
    if (!document) throw new Error(`Tu cuenta todavía no está creada: entrá una vez a ${APP_URL} y volvé a intentar.`)
    return document
  }

  function statusesOf(document: ResumeDocument) {
    return new Map(document.applicationStatuses.map((status) => [status.id, status]))
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  server.registerTool(
    'get_started',
    {
      title: 'Empezar',
      description:
        "Call this FIRST whenever work comes up in a conversation (jobs, a CV, a posting link, an interview or a call, a company, a recruiter, their career), even if the user does not mention Resume. Returns today's date, how complete their account is and what is missing, what is coming up, steps that already happened without a debrief, postings waiting for a decision, quiet processes, their pipeline, and where to start (start_with). Read-only; call it again whenever you need the picture.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const document = await open()
      const now = clock()
      const setup = setupStatus(document)
      const agenda = buildAgenda(document, now)
      const statusById = statusesOf(document)
      return json({
        today: now.toISOString(),
        today_note: 'UTC. Resolve "mañana", "el jueves"… against the user’s local date; if a time matters and their time zone is unclear, ask.',
        user: document.profile.name || null,
        setup: {
          mode: setup.mode,
          missing: setup.checks.filter((check) => !check.done).map(({ key, detail, items }) => ({ key, detail, ...(items ? { items } : {}) })),
          done: setup.checks.filter((check) => check.done).map((check) => check.key),
        },
        agenda: {
          upcoming: agenda.upcoming.map(agendaView),
          to_debrief: agenda.toDebrief.map(agendaView),
          considering: agenda.considering.map(agendaView),
          stale: agenda.stale.map(agendaView),
        },
        applications: {
          total: document.applications.length,
          open: document.applications.filter((application) => !['rejected', 'withdrawn'].includes(statusById.get(application.statusId)?.kind ?? '')).length,
        },
        pipeline: document.applicationStatuses.map((status) => ({ step: status.name, kind: status.kind })),
        start_with: startingPoints(setup, agenda, now),
        ...(setup.mode === 'empty' ? { onboarding_guide: ONBOARDING_GUIDE } : {}),
      })
    },
  )

  server.registerTool(
    'onboarding_guide',
    {
      title: 'Cómo cargar todo',
      description:
        "How to get the user's career into Resume: old CVs and LinkedIn first (import_career), then an interview role by role for achievements with numbers, voice notes welcome, contact details and studies, what they are looking for. Read it when the account is empty or get_started lists gaps.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: 'text' as const, text: ONBOARDING_GUIDE }] }),
  )

  server.registerTool(
    'describe_model',
    {
      title: 'Cómo es el documento',
      description: 'How the document is organized (every entity, field, allowed value and reference) and how to edit it. Read it before using update_document.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: 'text' as const, text: MODEL_GUIDE }] }),
  )

  server.registerTool(
    'cv_guidelines',
    {
      title: 'Cómo armar un CV',
      description: 'How to build a CV that passes screening (ATS and AI filters) and lands with recruiters: researching the company, what to select, how to write achievements and the summary, format. Read it before build_cv.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: 'text' as const, text: CV_GUIDE }] }),
  )

  server.registerTool(
    'get_document',
    {
      title: 'Ver todo',
      description:
        "The user's whole document: profile, experience bank and levels, CV sections, CVs, applications and statuses. CV graphs and version snapshots are left out unless graphs=true. Use include to fetch only some parts.",
      inputSchema: z.object({
        include: z.array(z.enum(documentParts)).optional(),
        graphs: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ include, graphs }) => json(documentView(await open(), { include, graphs })),
  )

  server.registerTool(
    'list_experiences',
    {
      title: 'Experiencias',
      description:
        "The experience bank: the achievements that may go into a CV, where each happened (the entry it is linked to) and the user's level. Filter with query (matches text, category and skills).",
      inputSchema: z.object({ query: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const document = await open()
      const words = fold(query ?? '').split(/\s+/).filter(Boolean)
      const levels = new Map(document.knowledge.map((answer) => [answer.id, answer.level]))
      const entries = new Map(
        sectionsView(document).flatMap((section) =>
          section.entries.map((entry) => [entry.id, `${section.name}: ${[entry.title, entry.subtitle].filter(Boolean).join(' — ')}`] as const),
        ),
      )
      return json(
        document.bank
          .filter((item) => words.every((word) => fold([item.text, item.category, ...item.skills].join(' ')).includes(word)))
          .map((item) => {
            const level = levels.get(item.id)
            const where = item.entryId ? entries.get(item.entryId) : undefined
            return {
              id: item.id,
              text: item.text,
              where: where ?? (item.entryId ? 'missing entry' : null),
              entry_id: item.entryId ?? null,
              skills: item.skills,
              category: item.category,
              level: level === undefined ? null : levelLabel[level],
            }
          }),
      )
    },
  )

  server.registerTool(
    'search_applications',
    {
      title: 'Buscar postulaciones',
      description: `Search job applications. text matches company, title, status, location and notes (accent-insensitive; "-word" excludes). stale_days keeps open ones with no activity for that many days (${STALE_DAYS} is a good default).`,
      inputSchema: z.object({
        text: z.string().optional(),
        status: z.array(z.string()).optional().describe('Status names or ids'),
        scope: z.enum(['open', 'closed', 'all']).default('all'),
        stale_days: z.number().int().min(1).optional(),
        sort: z.enum(['activity', 'applied', 'company']).default('activity'),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ text, status, scope, stale_days, sort, limit }) => {
      const document = await open()
      const now = clock()
      const statuses = document.applicationStatuses
      const query = {
        ...defaultQuery(),
        text: text ?? '',
        statusIds: (status ?? []).map((value) => resolveStatus(statuses, value).id),
        scope,
        staleDays: stale_days ?? null,
        sort,
      }
      const found = filterApplications(document.applications, statuses, query, now)
      return json({ total: found.length, applications: found.slice(0, limit).map((item) => summary(item, statusesOf(document), now)) })
    },
  )

  server.registerTool(
    'get_application',
    {
      title: 'Ver postulación',
      description: 'One application in full: history of steps and notes, posting text, attached CV and similar applications.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const document = await open()
      const now = clock()
      const statusById = statusesOf(document)
      const application = findApplication(document, id)
      return json({
        ...summary(application, statusById, now),
        posting: application.posting || undefined,
        own_cv: ownCvView(document, application),
        cv: cvAttachment(document, application.attachment),
        company: companyBrief(document, application),
        history: application.events.map((event) =>
          event.kind === 'status'
            ? { at: event.at, step: statusById.get(event.statusId)?.name ?? event.statusId, moved_to: statusById.get(event.statusId)?.name }
            : event.kind === 'debrief'
              ? { kind: 'debrief', ...debriefView(event, statusById) }
              : {
                  at: event.at,
                  step: statusById.get(event.statusId)?.name ?? event.statusId,
                  ...(event.kind !== 'note' ? { kind: event.kind } : {}),
                  note: event.text,
                  note_id: event.id,
                },
        ),
        similar: duplicateReport(findDuplicates(document.applications, application, application.id), statusById, now),
      })
    },
  )

  server.registerTool(
    'check_duplicates',
    {
      title: '¿Ya me postulé?',
      description:
        'Earlier applications that match a posting: the same posting (by URL), a similar role at the same company, or the same company. Run it before create_application and tell the user what it finds.',
      inputSchema: z.object({ company: z.string(), title: z.string(), url: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    async ({ company, title, url }) => {
      const document = await open()
      const matches = findDuplicates(document.applications, { company: company || companyFromUrl(url ?? ''), title, url })
      return json({ already_applied: matches.length > 0, matches: duplicateReport(matches, statusesOf(document), clock()) })
    },
  )

  // -------------------------------------------------------------------------
  // Generic editing
  // -------------------------------------------------------------------------

  server.registerTool(
    'update_document',
    {
      title: 'Editar',
      description:
        'Changes anything in the document with JSON Patch operations (add, remove, replace, move, copy, test): profile, jobs, education, experience bank, levels, sections, CVs, applications, statuses. Paths can select array items by id: /profile/jobs/[id=abc]/company. New items may omit their id. All operations apply together or none do. See describe_model for the structure.',
      inputSchema: z.object({
        operations: z.array(patchOperation).min(1),
        dry_run: z.boolean().default(false).describe('Preview the changes without saving'),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ operations, dry_run }) => {
      const document = await open()
      const result = patchDocument(document, operations as PatchOperation[], clock())
      if (!dry_run && result.changes.length > 0) await store.save(result.document)
      return json({
        saved: !dry_run && result.changes.length > 0,
        changes: result.changes,
        warnings: result.warnings,
        ...(result.changes.length === 0 ? { note: 'Nothing changed.' } : {}),
      })
    },
  )

  // -------------------------------------------------------------------------
  // Content: profile, sections → entries, experiences
  // -------------------------------------------------------------------------

  server.registerTool(
    'get_profile',
    {
      title: 'Perfil',
      description: 'Name and contact fields (email, phone, location, links…), plus any extra profile data. Jobs and studies are entries of the experience and education sections (list_sections).',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { profile } = await open()
      return json({ name: profile.name, fields: profile.fields.map(({ label, value, kind }) => ({ label, value, kind })), extra: profile.extra ?? {} })
    },
  )

  server.registerTool(
    'update_profile',
    {
      title: 'Editar perfil',
      description: 'Sets the name and contact fields. Fields are matched by label (case-insensitive): existing ones get the new value, others are added. remove_fields deletes by label. extra merges any other data (headline, nationality…).',
      inputSchema: z.object({
        name: z.string().optional(),
        fields: z.array(z.object({ label: z.string().min(1), value: z.string(), kind: z.enum(['email', 'phone', 'text', 'link']).optional() })).optional(),
        remove_fields: z.array(z.string()).optional(),
        extra: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ name, fields, remove_fields, extra }) => {
      const document = await open()
      const next = updateProfileInfo(document, { name, fields, removeFields: remove_fields, extra })
      await store.save(next)
      const missing = setupStatus(next).checks.filter((check) => !check.done && contactKeys.has(check.key)).map((check) => check.key)
      return json({
        name: next.profile.name,
        fields: next.profile.fields.map(({ label, value }) => ({ label, value })),
        follow_up: missing.length > 0 ? [`Still missing for CV headers: ${missing.join(', ')}. Ask for them when it fits.`] : [],
      })
    },
  )

  server.registerTool(
    'list_sections',
    {
      title: 'Secciones',
      description:
        'Every CV section with its entries: experience (entries are roles: title = role, subtitle = company), education (title = degree, subtitle = school), projects, and any section the user added (certifications, languages…). Each entry lists how many experiences are linked to it.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const document = await open()
      return json(
        sectionsView(document).map((section) => ({
          ...section,
          entries: section.entries.map((entry) => ({ ...entry, experiences: document.bank.filter((item) => item.entryId === entry.id).length })),
        })),
      )
    },
  )

  server.registerTool(
    'save_section',
    {
      title: 'Crear o editar sección',
      description: 'Creates a section (any name: "Certificaciones", "Idiomas", "Voluntariado"…) or renames / describes / (de)activates one. The name is the heading printed on CVs.',
      inputSchema: z.object({ section_id: z.string().optional(), name: z.string().min(1), description: z.string().optional(), active: z.boolean().optional() }),
      annotations: { idempotentHint: true },
    },
    async ({ section_id, name, description, active }) => {
      const document = await open()
      const { document: next, sectionId } = saveSection(document, { id: section_id, name, description, active })
      await store.save(next)
      return json({ section_id: sectionId, name })
    },
  )

  server.registerTool(
    'delete_section',
    {
      title: 'Eliminar sección',
      description: 'Deletes a section the user added, with its entries (their experiences stay in the bank, unlinked). Built-in sections are deactivated instead. Ask the user first.',
      inputSchema: z.object({ section_id: z.string() }),
      annotations: { destructiveHint: true },
    },
    async ({ section_id }) => {
      const document = await open()
      await store.save(deleteSection(document, section_id))
      return json({ deleted: section_id })
    },
  )

  server.registerTool(
    'save_entry',
    {
      title: 'Crear o editar entrada',
      description:
        'Creates or updates an entry of any section (by section id or name; a section that does not exist is created). Experience: title = role, subtitle = company (roles of the same company are grouped). Education: title = degree, subtitle = school. Others: title, subtitle (organization, issuer, level…), dates, description, url. Pass entry_id to update; only the fields sent change. Returns entry_id: link experiences to it with save_experience.',
      inputSchema: z.object({
        section: z.string().describe('Section id or name: "experience", "education", "Proyectos", "Certificaciones"…'),
        entry_id: z.string().optional(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        location: z.string().optional(),
        start: z.string().optional().describe('As printed: "2021", "Mar 2021"'),
        end: z.string().optional().describe('As printed: "2024", "Actualidad"'),
        description: z.string().optional(),
        url: z.string().optional(),
        extra: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ section, entry_id, ...fields }) => {
      const document = await open()
      const { document: next, sectionId, entryId } = saveEntry(document, section, { id: entry_id, ...fields })
      await store.save(next)
      const entry = sectionsView(next).find((item) => item.id === sectionId)?.entries.find((item) => item.id === entryId)
      return json({
        section_id: sectionId,
        entry_id: entryId,
        follow_up: afterEntry({ sectionId, entryId, achievements: next.bank.filter((item) => item.entryId === entryId).length, start: entry?.start ?? '' }),
      })
    },
  )

  server.registerTool(
    'delete_entry',
    {
      title: 'Eliminar entrada',
      description: 'Deletes an entry (a role, a study, a project…). Experiences linked to it stay in the bank, unlinked. Ask the user first.',
      inputSchema: z.object({ section: z.string(), entry_id: z.string() }),
      annotations: { destructiveHint: true },
    },
    async ({ section, entry_id }) => {
      const document = await open()
      await store.save(deleteEntry(document, section, entry_id))
      return json({ deleted: entry_id })
    },
  )

  server.registerTool(
    'save_experience',
    {
      title: 'Crear o editar experiencia',
      description:
        'Creates or updates an experience: one concrete achievement, written as the CV bullet ("Reduje la latencia un 40%…"). entry_id links it to where it happened (a role, a project… from list_sections; "" unlinks). level: how well the user knows it. Pass experience_id to update; only the fields sent change.',
      inputSchema: z.object({
        experience_id: z.string().optional(),
        text: z.string().optional(),
        entry_id: z.string().optional(),
        skills: z.array(z.string()).optional(),
        category: z.string().optional().describe('Short theme to group it: "Backend", "Liderazgo"…'),
        level: z.enum(['profesional', 'personal', 'sin experiencia']).nullable().optional(),
        extra: z.record(z.string(), z.unknown()).optional().describe('Metrics, dates, links…'),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ experience_id, entry_id, level, ...fields }) => {
      const document = await open()
      const { document: next, experienceId } = saveExperience(document, {
        id: experience_id,
        entryId: entry_id,
        level: level === undefined ? undefined : level === null ? null : levelValue[level],
        ...fields,
      })
      await store.save(next)
      const saved = next.bank.find((item) => item.id === experienceId)!
      return json({
        experience_id: experienceId,
        follow_up: afterExperience({ placed: !!saved.entryId, hasResult: hasResult(saved.text), hasSkills: saved.skills.length > 0 }),
      })
    },
  )

  const importedExperience = z.object({
    text: z.string().min(1).describe('One achievement, written as the CV bullet'),
    skills: z.array(z.string()).optional(),
    category: z.string().optional(),
    level: z.enum(['profesional', 'personal', 'sin experiencia']).nullable().optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  const toExperience = ({ level, ...item }: z.infer<typeof importedExperience>) => ({
    ...item,
    level: level === undefined ? undefined : level === null ? null : levelValue[level],
  })

  server.registerTool(
    'import_career',
    {
      title: 'Cargar todo junto',
      description:
        'Saves a whole career in one call: profile fields, roles (section "experience": title = role, subtitle = company), studies ("education": title = degree, subtitle = school), projects or any other section, each with the achievements that happened there (experiences). Use it for old CVs, a LinkedIn export, or a long story or voice note the user told. Safe to repeat: an entry with the same title and subtitle (and start) updates the existing one, blank fields never erase data, and achievements already in the bank are skipped. Top-level experiences add achievements to entries that already exist (entry_id from list_sections). The answer lists what is still missing (follow_up).',
      inputSchema: z.object({
        profile: z
          .object({
            name: z.string().optional(),
            fields: z.array(z.object({ label: z.string().min(1), value: z.string(), kind: z.enum(['email', 'phone', 'text', 'link']).optional() })).optional(),
            extra: z.record(z.string(), z.unknown()).optional(),
          })
          .optional(),
        entries: z
          .array(
            z.object({
              section: z.string().describe('"experience", "education", "projects", or any section name ("Certificaciones"…)'),
              entry_id: z.string().optional().describe('To update a known entry'),
              title: z.string().optional(),
              subtitle: z.string().optional(),
              location: z.string().optional(),
              start: z.string().optional().describe('As printed: "2021", "Mar 2021"'),
              end: z.string().optional().describe('As printed: "2024", "Actualidad"'),
              description: z.string().optional(),
              url: z.string().optional(),
              extra: z.record(z.string(), z.unknown()).optional(),
              experiences: z.array(importedExperience).optional(),
            }),
          )
          .optional(),
        experiences: z.array(importedExperience.extend({ entry_id: z.string() })).optional(),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ profile, entries, experiences }) => {
      const document = await open()
      const { document: next, report } = importCareer(document, {
        profile,
        entries: entries?.map(({ entry_id, experiences: items, ...fields }) => ({ ...fields, id: entry_id, experiences: items?.map(toExperience) })),
        experiences: experiences?.map(({ entry_id, ...item }) => ({ ...toExperience(item), entryId: entry_id })),
      })
      await store.save(next)
      return json({
        profile_updated: report.profile,
        entries: report.entries.map(({ section, entryId, title, subtitle, created }) => ({ section, entry_id: entryId, title, subtitle, created })),
        experiences_added: report.experiences.map(({ experienceId, entryId, text }) => ({ experience_id: experienceId, entry_id: entryId, text })),
        skipped_duplicates: report.skipped,
        follow_up: setupGaps(setupStatus(next)),
      })
    },
  )

  server.registerTool(
    'delete_experiences',
    {
      title: 'Eliminar experiencias',
      description: 'Deletes experiences from the bank (and their levels). CVs already generated keep their versions. Ask the user first.',
      inputSchema: z.object({ experience_ids: z.array(z.string()).min(1) }),
      annotations: { destructiveHint: true },
    },
    async ({ experience_ids }) => {
      const document = await open()
      const next = deleteExperiences(document, experience_ids)
      await store.save(next)
      return json({ deleted: document.bank.length - next.bank.length })
    },
  )

  server.registerTool(
    'set_experience_levels',
    {
      title: 'Niveles',
      description: 'Sets how well the user knows each experience: profesional, personal (side projects) or sin experiencia; null clears it.',
      inputSchema: z.object({
        levels: z.array(z.object({ experience_id: z.string(), level: z.enum(['profesional', 'personal', 'sin experiencia']).nullable() })).min(1),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ levels }) => {
      const document = await open()
      await store.save(setLevels(document, levels.map((item) => ({ id: item.experience_id, level: item.level === null ? null : levelValue[item.level] }))))
      return json({ updated: levels.length })
    },
  )

  // -------------------------------------------------------------------------
  // Applications
  // -------------------------------------------------------------------------

  server.registerTool(
    'create_application',
    {
      title: 'Nueva postulación',
      description:
        'Saves a job posting or an application. stage "considering": the user shared a posting and has not applied (a bare link, "mirá esto"): it goes to "Analizando propuesta" (created if their pipeline lacks it), with no applied date. stage "applied": they already sent it: it starts in the first open step. Send the full posting text: the answer says how it fits their experience (fit) and what to ask next (follow_up). If it looks like a posting or role they already have, nothing is created and the matches come back: ask the user, then call again with confirm_duplicate=true if they want to go ahead.',
      inputSchema: z.object({
        stage: z.enum(['considering', 'applied']).describe('"considering": weighing a posting, not applied yet · "applied": already sent'),
        company: z.string().min(1),
        title: z.string().min(1),
        url: z.string().optional(),
        location: z.string().optional(),
        posting: z.string().optional().describe('Full posting text, if available'),
        applied_on: isoDate.optional().describe("stage applied: the user's local date (YYYY-MM-DD); omitted = unknown"),
        note: z.string().optional().describe('First note: referral, salary asked, contact…'),
        confirm_duplicate: z.boolean().default(false),
      }),
    },
    async (input) => {
      const document = await open()
      const now = clock()
      const considering = input.stage === 'considering'
      const pipeline = considering ? consideringStatus(document.applicationStatuses) : { statuses: document.applicationStatuses, status: undefined, created: false }
      const statusById = new Map(pipeline.statuses.map((status) => [status.id, status]))
      const matches = findDuplicates(document.applications, input)
      if (!input.confirm_duplicate && matches.some((match) => match.reason !== 'same-company')) {
        return json({
          created: false,
          reason: 'Looks like an application the user already made. Show these to the user and ask before retrying with confirm_duplicate=true.',
          matches: duplicateReport(matches, statusById, now),
        })
      }
      const application = createApplication(
        {
          company: input.company,
          title: input.title,
          url: input.url,
          location: input.location,
          posting: input.posting,
          appliedOn: considering ? undefined : input.applied_on,
          note: input.note,
          statusId: pipeline.status?.id,
        },
        pipeline.statuses,
        now,
      )
      await store.save({ ...document, applicationStatuses: pipeline.statuses, applications: [...document.applications, application] })
      const fit = postingFit(document.bank, application.posting)
      const company = companyBrief(document, application)
      return json({
        created: true,
        application: summary(application, statusById, now),
        ...(pipeline.created ? { created_status: pipeline.status!.name } : {}),
        ...(fit
          ? {
              fit: {
                asks_for: fit.asked,
                backed_by_experience: fit.backed,
                not_in_experience: fit.missing,
                closest_experiences: fit.closest.map((item) => ({ id: item.id, text: item.text })),
              },
            }
          : {}),
        company,
        other_applications_at_company: duplicateReport(matches, statusById, now),
        follow_up: afterCreate({ considering, fit, hasPosting: !!application.posting.trim(), companySaved: company.saved }),
      })
    },
  )

  server.registerTool(
    'move_application',
    {
      title: 'Mover de estado',
      description:
        'Moves an application to another step (status name or id), optionally with a note for that step. Keeps the history. A status that does not exist yet is created (e.g. "Call con el CEO"); get_started lists the pipeline. Leaving "Analizando propuesta" for an open step means the user applied: that day is recorded (applied_on). For something coming up in the new step, also schedule_step.',
      inputSchema: z.object({
        id: z.string(),
        status: z.string(),
        note: z.string().optional(),
        applied_on: isoDate.optional().describe("When this move means they applied: the user's local date (YYYY-MM-DD); default today (UTC)"),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ id, status, note, applied_on }) => {
      const document = await open()
      const now = clock()
      const application = findApplication(document, id)
      const target = findOrCreateStatus(document.applicationStatuses, status)
      const next = moveApplication(application, target.status.id, note ?? '', now, { statuses: target.statuses, appliedOn: applied_on })
      const updated = { ...document, applicationStatuses: target.statuses, applications: document.applications.map((item) => (item.id === id ? next : item)) }
      if (next !== application || target.created) await store.save(updated)
      const applied = !application.appliedOn && !!next.appliedOn
      const pendingDebriefs = buildAgenda(updated, now).toDebrief.filter((item) => item.applicationId === id)
      return json({
        ...summary(next, statusesOf(updated), now),
        ...(target.created ? { created_status: target.status.name } : {}),
        ...(applied ? { applied_on_recorded: next.appliedOn } : {}),
        follow_up: afterMove({ to: target.status, applied, pendingDebriefs }),
      })
    },
  )

  server.registerTool(
    'schedule_step',
    {
      title: 'Agendar',
      description:
        "Puts something coming up on an application's calendar: a call, an interview, a challenge deadline (\"mañana tengo call con RRHH de X\"). move_to also moves the application to that step (status name or id, created if missing), as move_application would. Pass event_id to reschedule or fix one (from get_application or get_started). Resolve relative dates with today's date from get_started; send the time with the user's UTC offset when known (2026-11-20T15:00:00-03:00), or just the day.",
      inputSchema: z.object({
        application_id: z.string(),
        what: z.string().min(1).describe('What it is, with whom when known: "Call con Laura (RRHH)", "Entrega del challenge"'),
        at: momentInput.describe('YYYY-MM-DD, or ISO with the user’s offset'),
        kind: z.string().default('interview').describe('call, interview, challenge, meeting, task… (any word)'),
        move_to: z.string().optional().describe('Step the application moves to now, e.g. "Call con RRHH"'),
        event_id: z.string().optional().describe('To reschedule or fix an event already on the calendar'),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ application_id, what, at, kind, move_to, event_id }) => {
      const document = await open()
      const now = clock()
      const application = findApplication(document, application_id)
      const target = move_to ? findOrCreateStatus(document.applicationStatuses, move_to) : undefined
      const statuses = target?.statuses ?? document.applicationStatuses
      const moved = target ? moveApplication(application, target.status.id, '', now, { statuses }) : application
      const when = scheduledMoment(at, now)
      const { application: next, eventId } = scheduleEvent(moved, { id: event_id, at: when, kind, text: what, statusId: target?.status.id }, now)
      const updated = { ...document, applicationStatuses: statuses, applications: document.applications.map((item) => (item.id === application_id ? next : item)) }
      await store.save(updated)
      const statusById = statusesOf(updated)
      const event = next.events.find((item) => item.id === eventId)!
      return json({
        event_id: eventId,
        at: event.at,
        kind: event.kind,
        what: event.text,
        step: statusById.get(event.statusId)?.name ?? event.statusId,
        application: summary(next, statusById, now),
        ...(target?.created ? { created_status: target.status.name } : {}),
        follow_up: afterSchedule({ past: event.at <= now.toISOString() }),
      })
    },
  )

  server.registerTool(
    'add_note',
    {
      title: 'Agregar nota',
      description: 'Adds a note to the step the application is currently in (call notes, contacts, dates, feedback).',
      inputSchema: z.object({ id: z.string(), text: z.string().min(1) }),
    },
    async ({ id, text }) => {
      const document = await open()
      const now = clock()
      const application = findApplication(document, id)
      const next = addApplicationNote(application, text, now)
      await store.save({ ...document, applications: document.applications.map((item) => (item.id === id ? next : item)) })
      return json(summary(next, statusesOf(document), now))
    },
  )

  server.registerTool(
    'update_application',
    {
      title: 'Editar postulación',
      description: "Fixes an application's details (company, title, link, location, posting text, applied date). Only the fields sent change.",
      inputSchema: z.object({
        id: z.string(),
        company: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
        url: z.string().optional(),
        location: z.string().optional(),
        posting: z.string().optional(),
        applied_on: isoDate.optional(),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ id, applied_on, ...patch }) => {
      const document = await open()
      const now = clock()
      const application = findApplication(document, id)
      const changes = Object.fromEntries(Object.entries({ ...patch, appliedOn: applied_on }).filter(([, value]) => value !== undefined))
      const next = updateApplication(application, changes, now)
      await store.save({ ...document, applications: document.applications.map((item) => (item.id === id ? next : item)) })
      return json(summary(next, statusesOf(document), now))
    },
  )

  server.registerTool(
    'delete_application',
    {
      title: 'Eliminar postulación',
      description: 'Deletes an application and its history. Ask the user first.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      const document = await open()
      const application = findApplication(document, id)
      await store.save({ ...document, applications: document.applications.filter((item) => item.id !== id) })
      return json({ deleted: true, company: application.company, title: application.title })
    },
  )

  server.registerTool(
    'delete_status',
    {
      title: 'Eliminar estado',
      description: 'Removes a step from the pipeline. Applications in it move to move_to (status name or id), with that move recorded in their history.',
      inputSchema: z.object({ status: z.string(), move_to: z.string() }),
      annotations: { destructiveHint: true },
    },
    async ({ status, move_to }) => {
      const document = await open()
      const removed = resolveStatus(document.applicationStatuses, status)
      const target = resolveStatus(document.applicationStatuses, move_to)
      if (removed.id === target.id) throw new Error('move_to tiene que ser otro estado.')
      const result = removeStatus(document.applicationStatuses, document.applications, removed.id, target.id, clock())
      await store.save({ ...document, applicationStatuses: result.statuses, applications: result.applications })
      return json({ deleted: removed.name, moved: document.applications.filter((item) => item.statusId === removed.id).length, to: target.name })
    },
  )

  server.registerTool(
    'save_debrief',
    {
      title: 'Contar cómo fue',
      description:
        "Writes down how a step of an application went, in the user's words (a call, an interview, a challenge review): how it went, rating, who was there, what they asked, what the user said and did not say, what they liked and their doubts. Goes in the application's current step unless stage says otherwise. Pass debrief_id to change one; only the fields sent change (lists are replaced).",
      inputSchema: z.object({
        application_id: z.string(),
        debrief_id: z.string().optional().describe('Debrief to change (from get_application)'),
        stage: z.string().optional().describe('Status name or id; default: the current one'),
        at: momentInput.optional().describe('When it happened: YYYY-MM-DD or ISO; default now'),
        how_it_went: z.string().optional().describe('Summary in the user’s words'),
        rating: z.number().int().min(1).max(5).nullable().optional().describe('How it felt: 1 mal … 5 excelente'),
        people: listInput.optional().describe('Who was there: "Laura (RRHH)", "el CTO"'),
        asked: listInput.optional().describe('What they asked or asked for'),
        said: listInput.optional().describe('What the user answered or said: points made, numbers given'),
        unsaid: listInput.optional().describe('What the user did not say, held back or forgot'),
        liked: listInput.optional().describe('What they liked'),
        concerns: listInput.optional().describe('Their doubts or objections, what did not land'),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ application_id, debrief_id, stage, at, how_it_went, ...details }) => {
      const document = await open()
      const now = clock()
      const application = findApplication(document, application_id)
      const statusId = stage ? resolveStatus(document.applicationStatuses, stage).id : undefined
      const { application: next, eventId } = saveDebrief(
        application,
        { id: debrief_id, statusId, at: at ? pastMoment(at, now) : undefined, text: how_it_went, ...details },
        now,
      )
      await store.save({ ...document, applications: document.applications.map((item) => (item.id === application_id ? next : item)) })
      const event = next.events.find((item) => item.id === eventId)!
      return json({ ...debriefView(event, statusesOf(document)), follow_up: afterDebrief(event.debrief, event.text) })
    },
  )

  server.registerTool(
    'delete_event',
    {
      title: 'Borrar nota o bitácora',
      description: "Deletes a note, a debrief or a scheduled event from an application's history. Status changes stay: they are the history. Ask the user first.",
      inputSchema: z.object({ application_id: z.string(), event_id: z.string().describe('note_id or debrief_id from get_application') }),
      annotations: { destructiveHint: true },
    },
    async ({ application_id, event_id }) => {
      const document = await open()
      const application = findApplication(document, application_id)
      const next = removeApplicationNote(application, event_id, clock())
      if (next === application) throw new Error(`No hay una nota o bitácora ${event_id} en esta postulación (los cambios de estado no se borran).`)
      await store.save({ ...document, applications: document.applications.map((item) => (item.id === application_id ? next : item)) })
      return json({ deleted: event_id })
    },
  )

  // -------------------------------------------------------------------------
  // Companies
  // -------------------------------------------------------------------------

  server.registerTool(
    'get_company',
    {
      title: 'Ver empresa',
      description:
        "Everything about a company (by name or id): what it does, mission, vision, values, extra data, notes (news, layoffs, hiring, other openings, others' interviews…), and the user's applications to it with how each step went (debriefs). Use it to prepare an interview or before researching again.",
      inputSchema: z.object({ company: z.string().describe('Company name or company_id') }),
      annotations: { readOnlyHint: true },
    },
    async ({ company }) => {
      const document = await open()
      const now = clock()
      const statusById = statusesOf(document)
      const found = findCompany(document.companies, company)
      const name = found?.name ?? company
      const applications = applicationsTo(document.applications, name)
      if (!found && applications.length === 0) throw new Error(`No hay nada de ${company} todavía: guardalo con save_company.`)
      return json({
        ...(found ? companyView(found) : { company_id: null, name, saved: false, hint: 'Nothing saved yet: research it and use save_company / save_company_note.' }),
        applications: applications.map((application) => ({
          ...summary(application, statusById, now),
          debriefs: application.events.filter((event) => event.kind === 'debrief').map((event) => debriefView(event, statusById)),
        })),
      })
    },
  )

  server.registerTool(
    'save_company',
    {
      title: 'Guardar empresa',
      description:
        "Creates or updates what the user knows about a company: website, logo, what it does, mission, vision, values and extra data (industry, size, headquarters, founded, funding, stack, rating…). Found by company_id or by name (applications to it are matched by name). Only the fields sent change; extra merges (null removes a key). Renaming renames its applications. Save facts with dates (news, layoffs…) as notes with save_company_note. Never invent: use what you read, and say where.",
      inputSchema: z.object({
        company_id: z.string().optional(),
        name: z.string().optional().describe('Required to create; with company_id, renames'),
        website: z.string().optional(),
        logo: z.string().optional().describe('URL of a square logo image, if you have a reliable one; otherwise the website icon is used'),
        about: z.string().optional().describe('What they do: product, customers, stage, size; a few lines'),
        mission: z.string().optional(),
        vision: z.string().optional(),
        values: listInput.optional(),
        extra: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ company_id, ...input }) => {
      const document = await open()
      const { document: next, companyId, created } = saveCompany(document, { id: company_id, ...input })
      await store.save(next)
      const company = next.companies.find((item) => item.id === companyId)!
      return json({ company_id: companyId, created, name: company.name, applications: applicationsTo(next.applications, company.name).length })
    },
  )

  server.registerTool(
    'save_company_note',
    {
      title: 'Guardar info de la empresa',
      description: `Writes down one thing learned about a company, with when it happened and where it comes from. kind: ${knownNoteKinds}, or any other word. The company is found by name or id, and created when missing. Pass note_id to change a note; only the fields sent change.`,
      inputSchema: z.object({
        company: z.string().describe('Company name or company_id'),
        note_id: z.string().optional(),
        kind: z.string().optional().describe('Default: news'),
        date: noteDate.optional().describe('When it happened: YYYY-MM-DD, YYYY-MM or YYYY'),
        text: z.string().optional().describe('Required for a new note'),
        source: z.string().optional().describe('Link, or who said it'),
        extra: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ company, note_id, ...input }) => {
      const document = await open()
      const { document: next, companyId, noteId } = saveCompanyNote(document, company, { id: note_id, ...input }, clock())
      await store.save(next)
      return json({ company_id: companyId, note_id: noteId })
    },
  )

  server.registerTool(
    'delete_company_note',
    {
      title: 'Borrar info de la empresa',
      description: 'Deletes a note about a company. Ask the user first.',
      inputSchema: z.object({ company: z.string().describe('Company name or company_id'), note_id: z.string() }),
      annotations: { destructiveHint: true },
    },
    async ({ company, note_id }) => {
      const document = await open()
      const found = findCompany(document.companies, company)
      if (!found?.notes.some((note) => note.id === note_id)) throw new Error(`No existe la nota ${note_id} en ${company}.`)
      await store.save(deleteCompanyNote(document, found.id, note_id))
      return json({ deleted: note_id })
    },
  )

  server.registerTool(
    'delete_company',
    {
      title: 'Borrar empresa',
      description: 'Deletes what was saved about a company (info and notes). Its applications stay. Ask the user first.',
      inputSchema: z.object({ company: z.string().describe('Company name or company_id') }),
      annotations: { destructiveHint: true },
    },
    async ({ company }) => {
      const document = await open()
      const found = findCompany(document.companies, company)
      if (!found) throw new Error(`No hay nada guardado de ${company}.`)
      await store.save(deleteCompany(document, found.id))
      return json({ deleted: found.name, notes: found.notes.length })
    },
  )

  // -------------------------------------------------------------------------
  // CVs
  // -------------------------------------------------------------------------

  server.registerTool(
    'list_cvs',
    {
      title: 'Ver CVs',
      description:
        'The user\'s CVs. General: one per role or profile ("CV React", "CV Arquitecto"), the starting points. For applications: the copy made for each application, tailored to its posting. To make the CV for a new application, pick the general CV that fits best and copy_cv it with application_id.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const document = await open()
      const copies = copiesByCv(document)
      const statusById = statusesOf(document)
      const view = (cv: Cv) => ({
        cv_id: cv.id,
        title: cv.title,
        position: cv.position || undefined,
        company: cv.company || undefined,
        versions: cv.versions.length,
        last_version: cv.versions.at(-1)?.createdAt,
        based_on: baseTitle(document, cv),
      })
      return json({
        general: generalCvs(document).map((cv) => ({ ...view(cv), application_copies: copies.get(cv.id) ?? 0 })),
        for_applications: applicationCvs(document).map(({ cv, application }) => {
          const sent = application.attachment?.kind === 'cv' && application.attachment.cvId === cv.id ? application.attachment.versionId : undefined
          const sentIndex = sent ? cv.versions.findIndex((version) => version.id === sent) : -1
          return {
            ...view(cv),
            application_id: application.id,
            application: [application.company, application.title].filter(Boolean).join(' — '),
            step: statusById.get(application.statusId)?.name,
            sent_version: sentIndex >= 0 ? `v${sentIndex + 1}` : undefined,
          }
        }),
      })
    },
  )

  server.registerTool(
    'copy_cv',
    {
      title: 'Copiar CV',
      description:
        'Copies a CV. Without application_id: a new general CV (e.g. "CV Arquitecto" starting from "CV React"). With application_id: the CV of that application, tailored to its posting (one per application; it takes the role, company and posting from the application, and the original stays as it is). Then adjust the copy: build_cv with its cv_id to change the experiences, update_cv for the summary and the look.',
      inputSchema: z.object({
        cv_id: z.string().describe('The CV to copy (see list_cvs)'),
        title: z.string().optional().describe('Name of the copy. Default: the original name, with the company for an application'),
        application_id: z.string().optional(),
      }),
    },
    async ({ cv_id, title, application_id }) => {
      const document = await open()
      const { document: next, cvId } = copyCv(document, cv_id, { title, applicationId: application_id, now: clock() })
      await store.save(next)
      const { cv, snapshot } = draftOf(next, cvId)
      return json({
        cv_id: cvId,
        title: cv.title,
        based_on: baseTitle(next, cv),
        ...(cv.applicationId ? { application_id: cv.applicationId } : { general: true }),
        review: reviewCv(cv, snapshot, next.bank),
        review_and_download: APP_URL,
      })
    },
  )

  server.registerTool(
    'build_cv',
    {
      title: 'Armar CV',
      description:
        'Creates a CV (or rebuilds one with cv_id) from a selection and generates its version. You choose the experiences; the server places each under the entry it is linked to (roles in profile order, then education, then other sections like projects or certifications) and returns the outline. Experiences not linked to a shown entry are reported as unplaced: link them with save_experience and rebuild. Never draw the graph by hand.',
      inputSchema: z.object({
        cv_id: z.string().optional().describe('Rebuild this CV instead of creating one'),
        title: z.string().optional().describe('Name of the CV, e.g. "Tech Lead — Acme"'),
        position: z.string().optional().describe('Job it targets'),
        company: z.string().optional(),
        posting: z.string().optional(),
        summary: z.string().optional().describe('Profile paragraph at the top'),
        experience_ids: z.array(z.string()).describe('Experiences to show (see list_experiences), in the order you want them'),
        entry_ids: z
          .array(z.string())
          .optional()
          .describe('Only these entries (roles, studies, projects…). Default: every role and study, plus entries of other sections that have chosen experiences.'),
        section_ids: z.array(z.string()).optional().describe('Other sections to include (ids or names), in order. Default: those with chosen experiences.'),
        include_education: z.boolean().default(true),
        template: z.enum(templateIds).optional().describe('classic or modern (single column) are the safest for screening'),
        font: z.enum(fontIds).optional(),
        application_id: z
          .string()
          .optional()
          .describe(
            "The CV of this application (one per application): without cv_id, rebuilds that application's CV or creates it. With the cv_id of a general CV, records it as the CV sent there instead. To tailor a general CV for an application, copy_cv it first.",
          ),
      }),
    },
    async (input) => {
      const document = await open()
      const missing = input.experience_ids.filter((id) => !document.bank.some((item) => item.id === id))
      if (missing.length > 0) throw new Error(`Estas experiencias no existen: ${missing.join(', ')}. Usá list_experiences.`)
      if (input.application_id) findApplication(document, input.application_id)
      const own = input.application_id && !input.cv_id ? cvOfApplication(document, input.application_id) : undefined
      const { document: built, cvId, versionId, outline } = buildCv(
        document,
        {
          cvId: input.cv_id ?? own?.id,
          title: input.title,
          position: input.position,
          company: input.company,
          posting: input.posting,
          summary: input.summary,
          templateId: input.template,
          fontId: input.font,
          experienceIds: input.experience_ids,
          entryIds: input.entry_ids,
          sectionIds: input.section_ids,
          includeEducation: input.include_education,
        },
        clock(),
      )
      const next = !input.application_id
        ? built
        : input.cv_id && built.cvs.find((cv) => cv.id === cvId)?.applicationId !== input.application_id
          ? // A general CV sent as it is: the application records this version.
            {
              ...built,
              applications: built.applications.map((application) =>
                application.id === input.application_id
                  ? updateApplication(application, { attachment: { kind: 'cv', cvId, versionId } }, clock())
                  : application,
              ),
            }
          : assignCv(built, cvId, input.application_id, clock())
      await store.save(next)
      const cv = next.cvs.find((item) => item.id === cvId)!
      const review = reviewCv(cv, cv.versions.at(-1)!.snapshot, next.bank)
      return json({
        cv_id: cvId,
        version_id: versionId,
        ...(cv.applicationId ? { application_id: cv.applicationId } : { general: true }),
        outline,
        review,
        review_and_download: APP_URL,
      })
    },
  )

  server.registerTool(
    'update_cv',
    {
      title: 'Editar CV',
      description:
        "Changes a CV's name, target job, summary, style (template, font, size, spacing, margins, paper, skills format, accent color, section order) or the application it belongs to. Call build_cv_version afterwards to regenerate it.",
      inputSchema: z.object({
        cv_id: z.string(),
        title: z.string().optional(),
        position: z.string().optional(),
        company: z.string().optional(),
        posting: z.string().optional(),
        summary: z.string().optional(),
        template: z.enum(templateIds).optional().describe('classic or modern (single column) are the safest for screening'),
        font: z.enum(fontIds).optional(),
        font_size: z.union([z.literal(9), z.literal(10), z.literal(11), z.literal(12), z.literal(14)]).optional(),
        line_height: z.union([z.literal(1), z.literal(1.15), z.literal(1.5), z.literal(2)]).optional(),
        margins: z.enum(['narrow', 'normal', 'wide']).optional(),
        page_size: z.enum(['letter', 'a4']).optional(),
        skills_format: z.enum(['list', 'comma']).optional(),
        accent_color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .nullable()
          .optional()
          .describe(`Color of the name, headings and rules; null for none. Suggested: ${accentColors.map((color) => `${color.id} (${color.name})`).join(', ')}`),
        section_order: z
          .array(z.string())
          .optional()
          .describe('Body sections in display order, by id: experience, education, skills and other section ids. Missing ones follow.'),
        application_id: z
          .string()
          .nullable()
          .optional()
          .describe('Make it the CV of this application (one per application), or null to make it a general CV again'),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ cv_id, template, font, font_size, line_height, margins, page_size, skills_format, accent_color, section_order, application_id, ...meta }) => {
      const loaded = await open()
      if (!loaded.cvs.some((cv) => cv.id === cv_id)) throw new Error(`No existe el CV ${cv_id}.`)
      const document = application_id !== undefined ? assignCv(loaded, cv_id, application_id, clock()) : loaded
      const patch = Object.fromEntries(
        Object.entries({
          ...meta,
          templateId: template,
          fontId: font,
          fontSize: font_size,
          lineHeight: line_height,
          marginId: margins,
          pageSize: page_size,
          skillsFormat: skills_format,
          accentColor: accent_color === null ? DEFAULT_ACCENT : accent_color?.toLowerCase(),
          sectionOrder: section_order,
        }).filter(([, value]) => value !== undefined),
      )
      await store.save({ ...document, cvs: document.cvs.map((cv) => (cv.id === cv_id ? { ...cv, ...patch } : cv)) })
      return json({ updated: true, cv_id, changed: [...Object.keys(patch), ...(application_id !== undefined ? ['application_id'] : [])] })
    },
  )

  server.registerTool(
    'build_cv_version',
    {
      title: 'Generar versión',
      description:
        'Generates a new version of a CV from its current content (like "Generar" in the app). With pin_to_application_id, that application records this exact version as the one sent.',
      inputSchema: z.object({ cv_id: z.string(), pin_to_application_id: z.string().optional() }),
    },
    async ({ cv_id, pin_to_application_id }) => {
      const document = await open()
      if (!document.cvs.some((cv) => cv.id === cv_id)) throw new Error(`No existe el CV ${cv_id}.`)
      if (pin_to_application_id) findApplication(document, pin_to_application_id)
      const { document: built, versionId } = buildCvVersion(document, cv_id, { now: clock() })
      const next = pin_to_application_id
        ? {
            ...built,
            applications: built.applications.map((application) =>
              application.id === pin_to_application_id
                ? updateApplication(application, { attachment: { kind: 'cv', cvId: cv_id, versionId } }, clock())
                : application,
            ),
          }
        : built
      await store.save(next)
      const cv = next.cvs.find((item) => item.id === cv_id)!
      const review = reviewCv(cv, cv.versions.at(-1)!.snapshot, next.bank)
      return json({ version_id: versionId, version: cv.versions.length, review, review_and_download: APP_URL })
    },
  )

  server.registerTool(
    'delete_cv',
    {
      title: 'Eliminar CV',
      description: 'Deletes a CV and its versions; applications that had it attached forget it. Ask the user first.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      const document = await open()
      const cv = document.cvs.find((item) => item.id === id)
      if (!cv) throw new Error(`No existe el CV ${id}.`)
      await store.save(deleteCv(document, id))
      return json({ deleted: true, title: cv.title })
    },
  )

  // -------------------------------------------------------------------------
  // Prompts: the three everyday requests, for clients that list prompts
  // -------------------------------------------------------------------------

  const prompt = (text: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] })

  server.registerPrompt(
    'preparar-mi-resume',
    {
      title: 'Preparemos mi Resume',
      description: 'Revisa qué tenés y qué falta, y te va preguntando: CVs viejos, LinkedIn, logros con números, datos de contacto.',
    },
    () =>
      prompt(
        'Preparemos mi Resume: fijate qué tengo y qué me falta, y andá preguntándome de a poco. Si te sirven CVs viejos o mi LinkedIn, pedímelos; también te puedo contar cosas que hice o mandarte audios.',
      ),
  )

  server.registerPrompt(
    'actualizar-mi-info',
    { title: 'Actualizá mi info', description: 'Carga tu perfil, trabajos, estudios y experiencias con lo que el asistente sabe de vos.' },
    () => prompt('Actualizá mi info en Resume con todo lo que sabés de mí. Antes de guardar, mostrame un resumen y preguntame lo que falte (fechas, cifras). No inventes nada.'),
  )

  server.registerPrompt(
    'armar-cv',
    {
      title: 'Armar CV para un aviso',
      description: 'Analiza el aviso, chequea si ya te postulaste, crea la postulación y arma el CV.',
      argsSchema: z.object({ aviso: z.string().describe('Link del aviso o el texto pegado') }),
    },
    ({ aviso }) => prompt(`Armemos el CV para ${aviso}. Investigá la empresa, seguí cv_guidelines y revisá el review de build_cv antes de mostrármelo.`),
  )

  server.registerPrompt(
    'analizar-aviso',
    {
      title: 'Analizar un aviso',
      description: 'Guarda el aviso en "Analizando propuesta" y te dice cómo encaja con tu experiencia, antes de decidir si te postulás.',
      argsSchema: z.object({ aviso: z.string().describe('Link del aviso o el texto pegado') }),
    },
    ({ aviso }) => prompt(`Mirá este aviso: ${aviso}\n\nGuardalo en Resume como "Analizando propuesta", investigá la empresa y decime cómo encaja con mi experiencia.`),
  )

  server.registerPrompt(
    'como-me-fue',
    {
      title: 'Contar cómo me fue',
      description: 'Contale cómo fue una entrevista o una call y lo guarda en la bitácora de esa etapa.',
      argsSchema: z.object({
        empresa: z.string(),
        relato: z.string().describe('Qué pasó: qué te preguntaron, qué dijiste y qué no, qué les gustó…'),
      }),
    },
    ({ empresa, relato }) =>
      prompt(
        `Te cuento cómo me fue con ${empresa}: ${relato}\n\nGuardalo en la bitácora de esa etapa en Resume (qué me preguntaron, qué dije y qué no, qué les gustó, qué dudas tuvieron, con quién hablé). Si pasé a otra etapa, movela. Preguntame lo importante que falte.`,
      ),
  )

  server.registerPrompt(
    'investigar-empresa',
    {
      title: 'Investigar una empresa',
      description: 'Busca la empresa y guarda a qué se dedica, misión, visión, valores y novedades con fecha y fuente.',
      argsSchema: z.object({ empresa: z.string() }),
    },
    ({ empresa }) =>
      prompt(
        `Investigá ${empresa} y guardá en Resume lo que encuentres: web, a qué se dedica, misión, visión, valores, tamaño y sede; y como notas con fecha y fuente: despidos, contrataciones, inversión, otros puestos abiertos, cómo son sus entrevistas según otros. No inventes nada.`,
      ),
  )

  server.registerPrompt(
    'preparar-entrevista',
    {
      title: 'Preparar la próxima etapa',
      description: 'Arma la preparación con lo que sabés de la empresa y lo que contaste de las etapas anteriores.',
      argsSchema: z.object({ empresa: z.string() }),
    },
    ({ empresa }) =>
      prompt(
        `Preparame para la próxima etapa con ${empresa}. Usá lo que tenemos en Resume (get_company: la empresa, sus novedades y mis bitácoras de las etapas anteriores): qué me pueden preguntar, qué conviene contar, qué no dije la otra vez y debería, y qué preguntarles yo.`,
      ),
  )

  server.registerPrompt(
    'novedad',
    {
      title: 'Novedad de un proceso',
      description: 'Contale qué pasó con una postulación y la actualiza.',
      argsSchema: z.object({ novedad: z.string().describe('Ej: Me confirmaron de Acme, paso a la siguiente etapa, challenge el 20/3') }),
    },
    ({ novedad }) => prompt(novedad),
  )
}
