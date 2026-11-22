/**
 * Mapping between the in-memory ResumeDocument and the Postgres tables, plus the pure diff and
 * three-way merge the Supabase store uses to write only what changed and to fold in remote edits.
 */
import {
  readApplicationStatuses,
  readApplications,
  withReferencedStatuses,
  type Application,
  type ApplicationStatus,
} from '../../domain/applications'
import { readCompanies, type Company } from '../../domain/companies'
import { readExperiences } from '../../domain/experiences'
import type { Cv, CvVersion, KnowledgeAnswer, ResumeDocument, ResumeEdge, ResumeNode } from '../../domain/model'
import { parseGraph, parseProfile, parseRoleGraph, parseSnapshot, readEnabled, readOwner, readSections, readStyle } from '../../domain/parse'
import { isTemplateId } from '../../domain/templates'

/** In write order: parents before children. */
export const TABLES = [
  'profiles',
  'experiences',
  'sections',
  'role_templates',
  'cvs',
  'cv_versions',
  'application_statuses',
  'applications',
  'application_events',
  'companies',
  'company_notes',
] as const

export type TableName = (typeof TABLES)[number]

export type Row = { id: string } & Record<string, unknown>

export type Tables = Record<TableName, Row[]>

/** Columns read back from each table (user_id is implied: RLS returns only the user's rows). */
export const COLUMNS: Record<TableName, string> = {
  profiles: 'id,data',
  experiences: 'id,category,text,skills,aliases,entry_id,level,sort,extra',
  sections: 'id,name,description,active,built_in,entries,sort,extra',
  role_templates: 'id,graph,sort',
  cvs: 'id,title,target_role,target_company,posting,summary,style,enabled_sections,graph,application_id,based_on,sort,extra',
  cv_versions: 'id,cv_id,created_at,snapshot,sort',
  application_statuses: 'id,name,color,kind,sort,extra',
  applications: 'id,company,title,url,posting_key,posting,location,applied_on,status_id,attachment,created_at,updated_at,extra',
  application_events: 'id,application_id,at,kind,status_id,text,debrief,extra',
  companies: 'id,name,website,logo,about,mission,vision,core_values,sort,extra',
  company_notes: 'id,company_id,kind,happened_on,text,source,added_at,extra',
}

/** Built versions never change once written, so the diff only looks at which ids exist. */
const IMMUTABLE: ReadonlySet<TableName> = new Set(['cv_versions'])

const TIMESTAMPS: Partial<Record<TableName, string[]>> = {
  cv_versions: ['created_at'],
  applications: ['created_at', 'updated_at'],
  application_events: ['at'],
  company_notes: ['added_at'],
}

const EPOCH = new Date(0).toISOString()

export function emptyTables(): Tables {
  return Object.fromEntries(TABLES.map((table) => [table, []])) as unknown as Tables
}

// ---------------------------------------------------------------------------
// Document -> rows
// ---------------------------------------------------------------------------

export function toTables(document: ResumeDocument): Tables {
  const levels = new Map(document.knowledge.map((answer) => [answer.id, answer.level]))
  return {
    profiles: [{ id: 'me', data: document.profile }],
    experiences: document.bank.map((item, sort) => ({
      id: item.id,
      category: item.category,
      text: item.text,
      skills: item.skills,
      aliases: item.aliases,
      entry_id: item.entryId ?? null,
      level: levels.get(item.id) ?? null,
      sort,
      extra: item.extra ?? {},
    })),
    sections: document.sections.map((section, sort) => ({
      id: section.id,
      name: section.name,
      description: section.description,
      active: section.active,
      built_in: section.builtIn,
      entries: section.entries ?? [],
      sort,
      extra: section.extra ?? {},
    })),
    role_templates: document.roleGraphs.map((graph, sort) => ({
      id: graph.id,
      graph: graphJson(graph.nodes, graph.edges),
      sort,
    })),
    cvs: document.cvs.map((cv, sort) => cvRow(cv, document, sort)),
    cv_versions: document.cvs.flatMap((cv) => cv.versions.map((version, sort) => versionRow(cv.id, version, sort))),
    application_statuses: document.applicationStatuses.map((status, sort) => ({
      id: status.id,
      name: status.name,
      color: status.color,
      kind: status.kind,
      sort,
      extra: status.extra ?? {},
    })),
    applications: document.applications.map(applicationRow),
    application_events: document.applications.flatMap((application) =>
      application.events.map((event) => ({
        id: event.id,
        application_id: application.id,
        at: event.at || EPOCH,
        kind: event.kind,
        status_id: event.statusId,
        text: event.text,
        debrief: event.debrief ?? null,
        extra: event.extra ?? {},
      })),
    ),
    companies: document.companies.map(companyRow),
    company_notes: document.companies.flatMap((company) =>
      company.notes.map((note) => ({
        id: note.id,
        company_id: company.id,
        kind: note.kind,
        happened_on: note.date,
        text: note.text,
        source: note.source,
        added_at: note.addedAt || EPOCH,
        extra: note.extra ?? {},
      })),
    ),
  }
}

function companyRow(company: Company, sort: number): Row {
  return {
    id: company.id,
    name: company.name,
    website: company.website,
    logo: company.logo,
    about: company.about,
    mission: company.mission,
    vision: company.vision,
    core_values: company.values,
    sort,
    extra: company.extra ?? {},
  }
}

function cvRow(cv: Cv, document: ResumeDocument, sort: number): Row {
  // The open CV's live graph is document.nodes/edges; cv.nodes is only refreshed when switching CVs.
  const live = cv.id === document.activeCvId
  return {
    id: cv.id,
    title: cv.title,
    target_role: cv.position,
    target_company: cv.company,
    posting: cv.posting,
    summary: cv.summary,
    style: {
      templateId: cv.templateId,
      fontId: cv.fontId,
      fontSize: cv.fontSize,
      lineHeight: cv.lineHeight,
      marginId: cv.marginId,
      pageSize: cv.pageSize,
      skillsFormat: cv.skillsFormat,
      accentColor: cv.accentColor,
      sectionOrder: cv.sectionOrder,
    },
    enabled_sections: cv.enabledSections,
    graph: graphJson(live ? document.nodes : cv.nodes, live ? document.edges : cv.edges),
    application_id: cv.applicationId ?? null,
    based_on: cv.basedOn ?? null,
    sort,
    extra: cv.extra ?? {},
  }
}

function versionRow(cvId: string, version: CvVersion, sort: number): Row {
  return { id: version.id, cv_id: cvId, created_at: version.createdAt || null, snapshot: version.snapshot, sort }
}

function applicationRow(application: Application): Row {
  return {
    id: application.id,
    company: application.company,
    title: application.title,
    url: application.url,
    posting_key: application.postingKey,
    posting: application.posting,
    location: application.location,
    applied_on: application.appliedOn || null,
    status_id: application.statusId,
    attachment: application.attachment,
    created_at: application.createdAt || EPOCH,
    updated_at: application.updatedAt || application.createdAt || EPOCH,
    extra: application.extra ?? {},
  }
}

/** Persisted graph shape: canvas-only state (selection, measured size, drag) is dropped. */
export function graphJson(nodes: ResumeNode[], edges: ResumeEdge[]) {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      data: node.data,
    })),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
  }
}

// ---------------------------------------------------------------------------
// Rows -> document
// ---------------------------------------------------------------------------

/**
 * Rebuilds the document from rows. `previous` (the document on screen) keeps UI state that is
 * not stored: which CV is open and, when its graph did not change, the canvas selection.
 */
export function fromTables(tables: Tables, previous?: ResumeDocument): ResumeDocument {
  const profile = parseProfile(tables.profiles.find((row) => row.id === 'me')?.data)

  const bankRows = bySort(tables.experiences)
  const bank = readExperiences(
    bankRows.map((row) => ({
      id: row.id,
      category: row.category,
      text: row.text,
      skills: row.skills,
      aliases: row.aliases,
      entryId: row.entry_id,
      extra: row.extra,
    })),
  )
  const inBank = new Set(bank.map((item) => item.id))
  const knowledge: KnowledgeAnswer[] = bankRows.flatMap((row) => {
    const level = row.level
    return inBank.has(row.id) && (level === 0 || level === 1 || level === 2) ? [{ id: row.id, level }] : []
  })

  const sections = readSections(
    bySort(tables.sections).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      active: row.active,
      entries: row.entries,
      extra: row.extra,
    })),
  )
  const roleGraphs = bySort(tables.role_templates).flatMap((row) => parseRoleGraph(row.id, row.graph) ?? [])

  const versionsByCv = groupBy(bySort(tables.cv_versions), (row) => String(row.cv_id))
  const cvs: Cv[] = bySort(tables.cvs).map((row) => {
    const style = isRecord(row.style) ? row.style : {}
    const graph = parseGraph(row.graph)
    const versions = (versionsByCv.get(row.id) ?? []).flatMap((version): CvVersion[] => {
      const snapshot = parseSnapshot(version.snapshot)
      return snapshot ? [{ id: version.id, createdAt: readString(version.created_at), snapshot }] : []
    })
    return {
      id: row.id,
      title: readString(row.title),
      position: readString(row.target_role),
      company: readString(row.target_company),
      posting: readString(row.posting),
      summary: readString(row.summary),
      templateId: isTemplateId(style.templateId) ? style.templateId : 'classic',
      ...readStyle(style),
      enabledSections: readEnabled(row.enabled_sections),
      versions,
      nodes: graph.nodes,
      edges: graph.edges,
      ...readOwner({ applicationId: row.application_id, basedOn: row.based_on }),
      ...(isRecord(row.extra) && Object.keys(row.extra).length > 0 ? { extra: row.extra } : {}),
    }
  })

  const activeCvId = previous && cvs.some((cv) => cv.id === previous.activeCvId) ? previous.activeCvId : cvs[0]?.id ?? ''
  const active = cvs.find((cv) => cv.id === activeCvId)
  const keepCanvas =
    previous !== undefined &&
    previous.activeCvId === activeCvId &&
    active !== undefined &&
    canonical(graphJson(previous.nodes, previous.edges)) === canonical(graphJson(active.nodes, active.edges))

  const pipeline: ApplicationStatus[] = readApplicationStatuses(
    bySort(tables.application_statuses).map((row) => ({ id: row.id, name: row.name, color: row.color, kind: row.kind, extra: row.extra })),
  )
  const eventsByApplication = groupBy(
    tables.application_events,
    (row) => String(row.application_id),
  )
  const applications = readApplications(
    [...tables.applications]
      .sort((left, right) => readString(left.created_at).localeCompare(readString(right.created_at)) || left.id.localeCompare(right.id))
      .map((row) => ({
        id: row.id,
        company: row.company,
        title: row.title,
        url: row.url,
        posting: row.posting,
        location: row.location,
        appliedOn: row.applied_on ?? '',
        statusId: row.status_id,
        attachment: row.attachment,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        extra: row.extra,
        events: (eventsByApplication.get(row.id) ?? []).map((event) => ({
          id: event.id,
          at: event.at,
          kind: event.kind,
          statusId: event.status_id,
          text: event.text,
          debrief: event.debrief ?? undefined,
          extra: event.extra,
        })),
      })),
    pipeline,
  )
  const applicationStatuses = withReferencedStatuses(pipeline, applications)

  const notesByCompany = groupBy(tables.company_notes, (row) => String(row.company_id))
  const companies = readCompanies(
    bySort(tables.companies).map((row) => ({
      id: row.id,
      name: row.name,
      website: row.website,
      logo: row.logo,
      about: row.about,
      mission: row.mission,
      vision: row.vision,
      values: row.core_values,
      extra: row.extra,
      notes: (notesByCompany.get(row.id) ?? []).map((note) => ({
        id: note.id,
        kind: note.kind,
        date: note.happened_on,
        text: note.text,
        source: note.source,
        addedAt: note.added_at,
        extra: note.extra,
      })),
    })),
  )

  return {
    profile,
    sections,
    roleGraphs,
    bank,
    knowledge,
    cvs,
    activeCvId,
    nodes: keepCanvas ? previous.nodes : active?.nodes ?? [],
    edges: keepCanvas ? previous.edges : active?.edges ?? [],
    applications,
    applicationStatuses,
    companies,
  }
}

/** Rows as Postgres returns them, in the same canonical form `toTables` produces. */
export function normalizeRows(table: TableName, rows: Row[]): Row[] {
  const columns = TIMESTAMPS[table] ?? []
  if (columns.length === 0) return rows
  return rows.map((row) => {
    const copy: Row = { ...row }
    for (const column of columns) {
      const value = copy[column]
      copy[column] = typeof value === 'string' && value ? new Date(value).toISOString() : null
    }
    return copy
  })
}

// ---------------------------------------------------------------------------
// Diff and merge
// ---------------------------------------------------------------------------

export type TableOps = { table: TableName; upserts: Row[]; deletes: string[] }

/** Writes that turn `base` into `next`: changed or new rows to upsert, missing ids to delete. */
export function diffTables(base: Tables, next: Tables): TableOps[] {
  return TABLES.flatMap((table) => {
    const before = indexRows(base[table], table)
    const after = indexRows(next[table], table)
    const upserts = next[table].filter((row) => before.get(row.id) !== after.get(row.id))
    const deletes = [...before.keys()].filter((id) => !after.has(id))
    return upserts.length > 0 || deletes.length > 0 ? [{ table, upserts, deletes }] : []
  })
}

export function tablesEqual(left: Tables, right: Tables): boolean {
  return diffTables(left, right).length === 0
}

/**
 * Three-way merge at row level. Rows the user changed locally since `base` keep the local
 * version (they get saved next); every other row takes what is now stored remotely.
 */
export function mergeTables(base: Tables, local: Tables, remote: Tables): Tables {
  const merged = emptyTables()
  for (const table of TABLES) {
    const baseIndex = indexRows(base[table], table)
    const localIndex = indexRows(local[table], table)
    const localRows = new Map(local[table].map((row) => [row.id, row]))
    const remoteRows = new Map(remote[table].map((row) => [row.id, row]))
    const ids = new Set([...localRows.keys(), ...remoteRows.keys()])
    for (const id of ids) {
      const changedLocally = baseIndex.get(id) !== localIndex.get(id)
      const row = changedLocally ? localRows.get(id) : remoteRows.get(id)
      if (row) merged[table].push(row)
    }
  }
  return merged
}

function indexRows(rows: Row[], table: TableName): Map<string, string> {
  return new Map(rows.map((row) => [row.id, IMMUTABLE.has(table) ? '' : canonical(row)]))
}

/** JSON with sorted keys and without undefined values: equal data, equal string. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!isRecord(value)) return value
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) sorted[key] = sortKeys(value[key])
  }
  return sorted
}

function bySort(rows: Row[]): Row[] {
  return [...rows].sort((left, right) => Number(left.sort ?? 0) - Number(right.sort ?? 0) || left.id.localeCompare(right.id))
}

function groupBy(rows: Row[], key: (row: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const group = groups.get(key(row)) ?? []
    group.push(row)
    groups.set(key(row), group)
  }
  return groups
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
