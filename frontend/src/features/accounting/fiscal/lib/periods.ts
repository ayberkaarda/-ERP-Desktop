import {
  addDays,
  addMonths,
  daysInMonth,
  isValidCalendarDate,
  splitCalendarDate,
  toCalendarDate,
} from '@/lib/datetime'
import type { FiscalYear } from '../../shared/types'

export interface PlannedPeriod {
  number: number
  start_date: string
  end_date: string
}

/** Same day-of-month `months` later, clamped to the month length (Jan 31 + 1 -> Feb 28/29). */
function shiftMonths(date: string, months: number): string {
  const { year, month, day } = splitCalendarDate(date)
  const target = addMonths(year, month, months)
  return toCalendarDate(
    target.year,
    target.month,
    Math.min(day, daysInMonth(target.year, target.month)),
  )
}

/**
 * The periods the API generates for a year (PHASE3: 12 periods tiling the year, plus an optional
 * zero-length period 13 on the last day for year-end adjustments). Shown before creating so the
 * user sees what will exist; the server's list is authoritative afterwards.
 */
export function planPeriods(start: string, end: string, withAdjustment: boolean): PlannedPeriod[] {
  if (!isValidCalendarDate(start) || !isValidCalendarDate(end) || end < start) return []
  const out: PlannedPeriod[] = []
  for (let i = 0; i < 12; i += 1) {
    const from = shiftMonths(start, i)
    if (from > end) break
    const to = i === 11 ? end : addDays(shiftMonths(start, i + 1), -1)
    out.push({ number: i + 1, start_date: from, end_date: to > end ? end : to })
  }
  if (out.length > 0) {
    const last = out[out.length - 1]
    if (last) last.end_date = end
  }
  if (withAdjustment) out.push({ number: 13, start_date: end, end_date: end })
  return out
}

/** Suggested next year: the day after the latest year ends, twelve months long. */
export function suggestNextYear(years: readonly FiscalYear[], today: string) {
  const latest = [...years].sort((a, b) => (a.end_date < b.end_date ? 1 : -1))[0]
  const start = latest ? addDays(latest.end_date, 1) : `${today.slice(0, 4)}-01-01`
  const end = addDays(shiftMonths(start, 12), -1)
  const code = start.slice(0, 4)
  return { code, start_date: start, end_date: end }
}

/** True when two date ranges share at least one day (fiscal years never overlap). */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

/** Whole-month length check: a TDHP fiscal year is normally 12 months (special periods differ). */
export function monthsBetween(start: string, end: string): number {
  const s = splitCalendarDate(start)
  const e = splitCalendarDate(addDays(end, 1))
  return (e.year - s.year) * 12 + (e.month - s.month) + (e.day - s.day) / 31
}
