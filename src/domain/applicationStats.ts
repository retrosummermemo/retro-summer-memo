/**
 * Numbers about the job search, computed from the applications themselves: how many, where each
 * one is, how often companies answer, pass the user through screening or reject them, and where.
 * What an assistant needs to answer "¿cuántas postulaciones tengo?" or "¿cuál es mi tasa de
 * rechazo?" from the record instead of from memory. Pure functions only.
 */
import { STALE_DAYS, isStale } from './applicationFilters'
import { initialStatus, stageVisits, type Application, type ApplicationStatus } from './applications'

export type ApplicationStats = {
  /** The period counted (by the day each application was sent, or saved if not sent yet). */
  period: { from?: string; to?: string }
  /** Applications in the period, sent or not. */
  total: number
  /** Postings saved to weigh, not applied to yet. */
  considering: number
  /** Postings dropped without applying. Not counted as sent. */
  droppedBeforeApplying: number
  /** Sent: the base of every rate. */
  applied: number
  /** Sent and still open. */
  inProgress: number
  offers: number
  rejected: number
  /** Dropped by the user ("Descartado"). */
  withdrawn: number
  /** In steps of any other kind (paused…). */
  other: number
  /** Got any answer from the company: moved past the step they started in (a rejection counts). */
  responded: number
  /** Got past screening: reached a later open step or an offer. */
  passedScreening: number
  /** Percentages of `applied` (one decimal); null with nothing applied. */
  rates: { response: number | null; passedScreening: number | null; rejection: number | null; offer: number | null }
  /** Every step of the pipeline in order, with how many applications are in it now. */
  byStep: { step: string; kind: string; count: number }[]
  /** For rejected applications: the step they were in when rejected. */
  rejectedAt: { step: string; count: number }[]
  /** Applications sent per month (yyyy-mm), oldest first. */
  byMonth: { month: string; applied: number }[]
  /** Calendar days from applying to the first answer, over those that got one with a known date. */
  daysToFirstAnswer: { median: number; average: number; count: number } | null
  /** Open processes with no news for `STALE_DAYS` days or more. */
  stale: number
}

const closed = new Set(['offer', 'rejected', 'withdrawn'])

/** The day an application counts on: when it was sent, else when it was saved. */
function countedDay(application: Application): string {
  return application.appliedOn || application.createdAt.slice(0, 10)
}

function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 10
}

/**
 * Stats of the applications counted on a day within `from`…`to` (yyyy-mm-dd, both included;
 * either may be left out).
 */
export function applicationStats(
  applications: Application[],
  statuses: ApplicationStatus[],
  options: { from?: string; to?: string; now?: Date } = {},
): ApplicationStats {
  const now = options.now ?? new Date()
  const statusById = new Map(statuses.map((status) => [status.id, status]))
  const kindOf = (statusId: string) => statusById.get(statusId)?.kind ?? 'active'
  const first = statuses.length > 0 ? initialStatus(statuses) : undefined
  const counted = applications.filter((application) => {
    const day = countedDay(application)
    return (!options.from || day >= options.from) && (!options.to || day <= options.to)
  })

  let considering = 0
  let droppedBeforeApplying = 0
  let inProgress = 0
  let offers = 0
  let rejected = 0
  let withdrawn = 0
  let other = 0
  let responded = 0
  let passedScreening = 0
  let stale = 0
  const rejectedAt = new Map<string, number>()
  const byMonth = new Map<string, number>()
  const answerDays: number[] = []

  for (const application of counted) {
    const kind = kindOf(application.statusId)
    if (kind === 'considering') {
      considering += 1
      continue
    }
    // The steps it went through, from the one it started in once sent.
    const visits = stageVisits(application, now).filter((visit) => kindOf(visit.statusId) !== 'considering')
    if (!application.appliedOn && visits.every((visit) => kindOf(visit.statusId) === 'withdrawn')) {
      droppedBeforeApplying += 1
      continue
    }
    if (kind === 'active') inProgress += 1
    else if (kind === 'offer') offers += 1
    else if (kind === 'rejected') rejected += 1
    else if (kind === 'withdrawn') withdrawn += 1
    else other += 1
    if (!closed.has(kind) && isStale(application, statusById, STALE_DAYS, now)) stale += 1
    if (application.appliedOn) byMonth.set(application.appliedOn.slice(0, 7), (byMonth.get(application.appliedOn.slice(0, 7)) ?? 0) + 1)

    const start = visits[0]?.statusId ?? first?.id
    const answer = visits.find((visit) => visit.statusId !== start && kindOf(visit.statusId) !== 'withdrawn')
    if (answer) {
      responded += 1
      if (application.appliedOn) {
        const days = Math.floor((Date.parse(answer.since) - Date.parse(`${application.appliedOn}T00:00:00.000Z`)) / 86_400_000)
        if (Number.isFinite(days)) answerDays.push(Math.max(0, days))
      }
    } else if (kind === 'rejected' || kind === 'offer') {
      // Saved straight in its outcome: an answer, with no date to measure.
      responded += 1
    }
    if (kind === 'offer' || visits.some((visit) => visit.statusId !== start && (kindOf(visit.statusId) === 'active' || kindOf(visit.statusId) === 'offer'))) passedScreening += 1
    if (kind === 'rejected') {
      const before = visits.filter((visit) => kindOf(visit.statusId) !== 'rejected').at(-1)?.statusId ?? start
      const step = (before && statusById.get(before)?.name) || 'Sin dato'
      rejectedAt.set(step, (rejectedAt.get(step) ?? 0) + 1)
    }
  }

  const applied = counted.length - considering - droppedBeforeApplying
  const sortedDays = [...answerDays].sort((left, right) => left - right)
  const middle = Math.floor(sortedDays.length / 2)
  const order = new Map(statuses.map((status, index) => [status.name, index]))

  return {
    period: { ...(options.from ? { from: options.from } : {}), ...(options.to ? { to: options.to } : {}) },
    total: counted.length,
    considering,
    droppedBeforeApplying,
    applied,
    inProgress,
    offers,
    rejected,
    withdrawn,
    other,
    responded,
    passedScreening,
    rates: {
      response: percent(responded, applied),
      passedScreening: percent(passedScreening, applied),
      rejection: percent(rejected, applied),
      offer: percent(offers, applied),
    },
    byStep: [
      ...statuses.map((status) => ({ step: status.name, kind: status.kind, count: counted.filter((item) => item.statusId === status.id).length })),
      // Applications in a step that is no longer in the pipeline.
      ...[...new Set(counted.map((item) => item.statusId).filter((id) => !statusById.has(id)))].map((id) => ({
        step: id,
        kind: 'unknown',
        count: counted.filter((item) => item.statusId === id).length,
      })),
    ],
    rejectedAt: [...rejectedAt]
      .map(([step, count]) => ({ step, count }))
      .sort((left, right) => right.count - left.count || (order.get(left.step) ?? 99) - (order.get(right.step) ?? 99)),
    byMonth: [...byMonth].sort(([left], [right]) => left.localeCompare(right)).map(([month, count]) => ({ month, applied: count })),
    daysToFirstAnswer:
      sortedDays.length === 0
        ? null
        : {
            median: sortedDays.length % 2 ? sortedDays[middle] : Math.round(((sortedDays[middle - 1] + sortedDays[middle]) / 2) * 10) / 10,
            average: Math.round((sortedDays.reduce((sum, days) => sum + days, 0) / sortedDays.length) * 10) / 10,
            count: sortedDays.length,
          },
    stale,
  }
}
