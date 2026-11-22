import { describe, expect, it } from 'vitest'
import { createApplication, defaultApplicationStatuses, moveApplication, type Application } from './applications'
import { applicationStats } from './applicationStats'

const statuses = defaultApplicationStatuses()
const day = (value: string) => new Date(`${value}T12:00:00.000Z`)
const now = day('2026-03-31')

/** An application sent on `sent`, then moved through `steps` ([status id, day]). */
function applied(company: string, sent: string, steps: [string, string][] = []): Application {
  let application = createApplication({ company, title: 'Backend', appliedOn: sent }, statuses, day(sent))
  for (const [statusId, on] of steps) application = moveApplication(application, statusId, '', day(on), { statuses })
  return application
}

function considered(company: string, saved: string, steps: [string, string][] = []): Application {
  let application = createApplication({ company, title: 'Backend', statusId: 'considering' }, statuses, day(saved))
  for (const [statusId, on] of steps) application = moveApplication(application, statusId, '', day(on), { statuses, appliedOn: on })
  return application
}

const applications = [
  applied('Acme', '2026-01-10', [['hr-call', '2026-01-15'], ['interview', '2026-01-25'], ['rejected', '2026-02-01']]),
  applied('Globex', '2026-01-20', [['rejected', '2026-01-22']]),
  applied('Initech', '2026-02-05', [['accepted', '2026-02-12'], ['offer', '2026-03-01']]),
  applied('Hooli', '2026-02-10'),
  applied('Umbrella', '2026-03-01', [['withdrawn', '2026-03-05']]),
  considered('Ualá', '2026-03-20'),
  considered('Stark', '2026-03-02', [['withdrawn', '2026-03-03']]),
  considered('Wayne', '2026-03-10', [['sent', '2026-03-12'], ['hr-call', '2026-03-20']]),
]

describe('applicationStats', () => {
  it('counts where every application is and how the process went', () => {
    const stats = applicationStats(applications, statuses, { now })
    expect(stats).toMatchObject({
      total: 8,
      considering: 1,
      droppedBeforeApplying: 1,
      applied: 6,
      inProgress: 2,
      offers: 1,
      rejected: 2,
      withdrawn: 1,
      other: 0,
      // Acme, Globex (a rejection is an answer), Initech, Wayne. Hooli is waiting; Umbrella was dropped by the user.
      responded: 4,
      // Acme, Initech, Wayne.
      passedScreening: 3,
      rates: { response: 66.7, passedScreening: 50, rejection: 33.3, offer: 16.7 },
    })
    expect(stats.byStep.find((step) => step.step === 'Rechazado')).toEqual({ step: 'Rechazado', kind: 'rejected', count: 2 })
    expect(stats.byStep.map((step) => step.step)).toEqual(statuses.map((status) => status.name))
    expect(stats.rejectedAt).toEqual([
      { step: 'CV enviado', count: 1 },
      { step: 'Entrevista técnica', count: 1 },
    ])
    expect(stats.byMonth).toEqual([
      { month: '2026-01', applied: 2 },
      { month: '2026-02', applied: 2 },
      { month: '2026-03', applied: 2 },
    ])
    // Acme 5 days, Globex 2, Initech 7, Wayne 8.
    expect(stats.daysToFirstAnswer).toEqual({ median: 6, average: 5.5, count: 4 })
    // Hooli: no news since February.
    expect(stats.stale).toBe(1)
  })

  it('limits the count to a period, by the day each application was sent or saved', () => {
    const february = applicationStats(applications, statuses, { from: '2026-02-01', to: '2026-02-28', now })
    expect(february).toMatchObject({ period: { from: '2026-02-01', to: '2026-02-28' }, total: 2, applied: 2, offers: 1, inProgress: 1 })
    expect(applicationStats(applications, statuses, { from: '2026-03-15', now })).toMatchObject({ total: 1, considering: 1, applied: 0 })
  })

  it('has no rates with nothing sent, and counts outcomes saved without history', () => {
    expect(applicationStats([], statuses, { now }).rates).toEqual({ response: null, passedScreening: null, rejection: null, offer: null })
    const straight = createApplication({ company: 'X', title: 'Y', appliedOn: '2026-01-01', statusId: 'rejected' }, statuses, day('2026-01-05'))
    expect(applicationStats([straight], statuses, { now })).toMatchObject({ applied: 1, rejected: 1, responded: 1, daysToFirstAnswer: null })
  })
})
