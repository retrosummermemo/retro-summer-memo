/**
 * What the assistant should ask or offer next, sent back with tool results as `follow_up`. This is
 * what turns single commands into a conversation: the server knows what is missing after each
 * change, so every assistant (Claude, ChatGPT, Gemini…) keeps the same back-and-forth.
 */
import { CONSIDERING_DAYS, type Agenda, type AgendaItem, type Setup, type SetupKey } from '../domain/assistantBrief'
import { STALE_DAYS } from '../domain/applicationFilters'
import type { ApplicationStatus, Debrief } from '../domain/applications'
import type { PostingFit } from '../domain/cvReview'

const what = (item: AgendaItem) => (item.text ? `"${item.text}"` : item.kind ?? 'the step')
const day = (iso?: string) => (iso ? iso.slice(0, 16).replace('T', ' ') : '')
const contactLabels: Partial<Record<SetupKey, string>> = { name: 'name', email: 'email', phone: 'phone', location: 'city/country', linkedin: 'LinkedIn' }

/** Setup gaps, most important first. */
export function setupGaps(setup: Setup): string[] {
  const missing = (key: SetupKey) => setup.checks.find((check) => check.key === key && !check.done)
  const gaps: string[] = []
  if (setup.mode === 'empty') {
    gaps.push(
      'The account is empty: run the onboarding (onboarding_guide). Ask first for old CVs, a LinkedIn PDF export or a portfolio, and load everything with import_career; then fill the gaps one question at a time.',
    )
    return gaps
  }
  const contact = Object.entries(contactLabels).filter(([key]) => missing(key as SetupKey)).map(([, label]) => label)
  if (missing('roles')) gaps.push('No jobs yet: ask for their work history (roles, companies, dates) and load it with import_career.')
  const rolesWithout = missing('roles_without_achievements')
  if (rolesWithout?.items?.length) {
    gaps.push(`No achievements at ${rolesWithout.items.slice(0, 3).join('; ')}: ask what they did there and what came of it, with numbers, and save them linked to the role.`)
  }
  if (contact.length > 0) gaps.push(`Missing contact details for CV headers: ${contact.join(', ')} (update_profile).`)
  if (missing('achievements') && !missing('roles')) gaps.push('No achievements yet: ask for them role by role (import_career).')
  const unplaced = missing('unplaced_achievements')
  if (unplaced) gaps.push(`${unplaced.detail} Ask where each happened and link it (save_experience entry_id).`)
  const noResults = missing('achievements_without_results')
  if (noResults?.items?.length) gaps.push(`${noResults.detail} Ask for the number behind a few, e.g. "${noResults.items[0]}". Never invent one.`)
  if (missing('education')) gaps.push('No studies yet: ask for degrees, courses or bootcamps worth showing.')
  return gaps
}

/** Where to start a conversation: time-sensitive things first, then setup, then housekeeping. */
export function startingPoints(setup: Setup, agenda: Agenda, now: Date, limit = 6): string[] {
  const points: string[] = []
  for (const item of agenda.toDebrief.slice(0, 2)) {
    points.push(`${item.company} — ${what(item)} was ${item.days === 0 ? 'today' : `${item.days} day(s) ago`} and has no debrief: ask how it went and save it (save_debrief, application ${item.applicationId}).`)
  }
  const soon = agenda.upcoming.filter((item) => Date.parse(item.at!) - now.getTime() <= 3 * 86_400_000)
  for (const item of soon.slice(0, 2)) {
    points.push(`${item.company} — ${what(item)} on ${day(item.at)} (UTC): offer to prepare it (get_company: company, notes and earlier debriefs).`)
  }
  points.push(...setupGaps(setup).slice(0, 2))
  const waiting = agenda.considering.filter((item) => (item.days ?? 0) >= CONSIDERING_DAYS)
  if (waiting.length > 0) {
    points.push(
      `${waiting.length} posting(s) waiting for a decision (${waiting.slice(0, 3).map((item) => `${item.company} — ${item.title}, ${item.days} days`).join('; ')}): ask whether to apply (build_cv) or discard them (move_application to the withdrawn step, with the reason).`,
    )
  }
  if (agenda.stale.length > 0) {
    points.push(`No news for ${STALE_DAYS}+ days from ${agenda.stale.slice(0, 3).map((item) => item.company).join(', ')}: ask whether anything happened (move_application, schedule_step) or close them.`)
  }
  if (setup.mode === 'ready' && setup.checks.find((check) => check.key === 'cv' && !check.done)) {
    points.push('No CV yet: offer a general one for the role they aim at ("CV React"), the starting point for each application.')
  }
  return points.slice(0, limit)
}

/** After saving a posting or an application. */
export function afterCreate({ considering, fit, hasPosting, companySaved }: { considering: boolean; fit?: PostingFit; hasPosting: boolean; companySaved: boolean }): string[] {
  const steps: string[] = []
  if (considering) {
    if (!hasPosting) {
      steps.push('No posting text, so no fit analysis: read the link, or ask the user to paste the posting if the site needs a login (LinkedIn often does), then update_application with posting.')
    } else if (fit) {
      steps.push(
        'Give the user a short take on the posting: what fits (fit.backed_by_experience and fit.closest_experiences, their real achievements), the gaps (fit.not_in_experience: talk about them, never put them on a CV without the user confirming), seniority, modality and salary if stated, anything odd.',
      )
    }
    steps.push('Then ask what they want: apply (its CV: copy_cv from the general CV that fits best with application_id, tailor it with build_cv; then move_application to the first step once sent) or discard it (move_application to the withdrawn step, with the reason as note).')
  } else {
    steps.push('Offer a CV tailored to this posting if they did not send one built here (copy_cv from a general CV with application_id), and ask whether there is a next step or a date already (schedule_step).')
  }
  if (!companySaved) steps.push('Nothing saved about this company yet: research it and save what you find (save_company, save_company_note with dates and sources).')
  return steps
}

/** After moving an application to another step. */
export function afterMove({ to, applied, pendingDebriefs }: { to: ApplicationStatus; applied: boolean; pendingDebriefs: AgendaItem[] }): string[] {
  const steps: string[] = []
  for (const item of pendingDebriefs.slice(0, 1)) steps.push(`${what(item)} (${day(item.at)}) has no debrief yet: ask how it went (save_debrief).`)
  if (applied) steps.push('They applied: ask how (referral, portal, recruiter) and keep it as a note if useful.')
  switch (to.kind) {
    case 'considering':
      break
    case 'offer':
      steps.push('Ask for the terms (salary, start date, modality, deadline to answer) and save them (update_application extra or a note). Offer to compare it with their other open processes.')
      break
    case 'rejected':
      steps.push('Ask whether they got feedback and keep it in a debrief of the last step (save_debrief): what to learn for other processes.')
      break
    case 'withdrawn':
      steps.push('Ask why, if they did not say, and keep it as a note: it shows which postings they discard.')
      break
    default:
      steps.push(`Ask when "${to.name}" is and with whom, if they did not say, and put it on the calendar (schedule_step). Offer to prepare it (get_company and debriefs of earlier steps).`)
  }
  return steps
}

/** After putting something on an application's calendar. */
export function afterSchedule({ past }: { past: boolean }): string[] {
  if (past) return ['That date already passed: if it happened, ask how it went (save_debrief).']
  return [
    'Ask who it is with and the format (video, on-site, technical, with whom…) if unknown, and keep it in what (schedule_step with event_id).',
    'Offer to prepare it: get_company (company, notes, earlier debriefs), likely questions, what to stress.',
    'After it happens, ask how it went (save_debrief).',
  ]
}

/** After a debrief: the parts worth asking for, at most two. */
export function afterDebrief(debrief: Debrief | undefined, text: string): string[] {
  const steps: string[] = []
  if (!text) steps.push('Ask how it went overall, in their words.')
  if (!debrief?.asked.length) steps.push('Ask what they were asked or asked for.')
  else if (!debrief.unsaid.length) steps.push('Ask whether there is anything they wish they had said: it goes into the next preparation.')
  if (debrief && debrief.rating === null) steps.push('Ask how it felt, 1 to 5.')
  return [...steps.slice(0, 2), 'If they moved on or have a date for the next step: move_application / schedule_step.']
}

/** After saving an entry (a role, a study, a project…). */
export function afterEntry({ sectionId, entryId, achievements, start }: { sectionId: string; entryId: string; achievements: number; start: string }): string[] {
  const steps: string[] = []
  if (sectionId !== 'education' && achievements === 0) {
    steps.push(`No achievements here yet: ask what they did and what came of it (numbers, scale, impact), 3–5 of them, and save them with entry_id ${entryId}.`)
  }
  if (!start) steps.push('Ask for the dates (start and end).')
  return steps
}

/** After saving an achievement. */
export function afterExperience({ placed, hasResult, hasSkills }: { placed: boolean; hasResult: boolean; hasSkills: boolean }): string[] {
  const steps: string[] = []
  if (!placed) steps.push('Not linked to where it happened (entry_id): it cannot go on a CV until it is.')
  if (!hasResult) steps.push('No measurable result: ask for the number behind it (%, time, money, users, scale) if there is one. Never invent it.')
  if (!hasSkills) steps.push('Add the skills it shows (skills): they are what postings are matched against.')
  return steps
}
