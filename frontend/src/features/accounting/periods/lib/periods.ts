import { isApiError } from '@/platform'
import type { AccountingPeriod, FiscalYear, PeriodAction, PeriodStatus } from '../../shared/types'

/** Transitions each status allows (PHASE3: open -> soft_closed -> closed, reopen back to open). */
export const ALLOWED: Record<PeriodStatus, readonly PeriodAction[]> = {
  open: ['soft-close', 'close'],
  soft_closed: ['close', 'reopen'],
  closed: ['reopen'],
}

export function allowedActions(period: AccountingPeriod): readonly PeriodAction[] {
  return ALLOWED[period.status]
}

export interface BlockedReason {
  message: string
  draftCount: number | null
  details: string[]
}

/** Words of the API's localized period_has_drafts message (tr/en/de/fr). */
const DRAFT_WORDS = /draft|taslak|entw(u|ü)rf|brouillon/i

/**
 * Recognizes the API's refusal to close a period that still has draft entries: 422
 * VALIDATION_ERROR with the localized message on `status` ("The period still has 2 draft journal
 * entries."). The board's own up-front check uses a `draft_entries` field. Other refusals on
 * `status` (wrong transition, closed year) are not draft refusals.
 */
export function readBlockedReason(error: unknown): BlockedReason | null {
  if (!isApiError(error) || (error.status !== 409 && error.status !== 422)) return null
  const fieldKeys = Object.keys(error.fields)
  const draftKeys = fieldKeys.filter(
    (k) =>
      /draft/i.test(k) ||
      (k === 'status' && (error.fields[k] ?? []).some((m) => DRAFT_WORDS.test(m))),
  )
  if (!/DRAFT/i.test(error.code) && draftKeys.length === 0) return null
  let draftCount: number | null = null
  for (const key of draftKeys) {
    for (const m of error.fields[key] ?? []) {
      const n = /\d+/.exec(m)
      if (n) draftCount = Number(n[0])
    }
  }
  // Bare counts are shown through draftCount and the message once, not repeated as details.
  const details = fieldKeys
    .flatMap((k) => error.fields[k] ?? [])
    .filter((m) => !/^\d+$/.test(m) && m !== error.message)
  return { message: error.message, draftCount, details }
}

/** Month label of a period ("Ocak 2027") from its start date; 13 is the adjustment period. */
export function periodLabel(period: AccountingPeriod, locale: string): string {
  const [y, m] = period.start_date.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1))
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/** URL > last used > the open year containing today > the latest year. */
export function pickDefaultYear(years: readonly FiscalYear[], today: string, last: string | null) {
  if (last && years.some((y) => y.id === last)) return last
  const current = years.find((y) => y.start_date <= today && today <= y.end_date)
  return (current ?? years[0])?.id ?? null
}
