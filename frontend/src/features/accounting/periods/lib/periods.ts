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

/**
 * Recognizes the API's refusal to close a period that still has draft entries. The code is not
 * fixed by the contract, so any 409/422 whose code or fields mention drafts counts.
 */
export function readBlockedReason(error: unknown): BlockedReason | null {
  if (!isApiError(error) || (error.status !== 409 && error.status !== 422)) return null
  const fieldKeys = Object.keys(error.fields)
  const mentionsDrafts = /DRAFT/i.test(error.code) || fieldKeys.some((k) => /draft/i.test(k))
  if (!mentionsDrafts) return null
  let draftCount: number | null = null
  for (const key of fieldKeys) {
    if (!/draft/i.test(key)) continue
    for (const m of error.fields[key] ?? []) {
      const n = /\d+/.exec(m)
      if (n) draftCount = Number(n[0])
    }
  }
  // Bare counts are shown through draftCount, not repeated as text.
  const details = fieldKeys.flatMap((k) => error.fields[k] ?? []).filter((m) => !/^\d+$/.test(m))
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
