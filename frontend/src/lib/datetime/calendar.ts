// Calendar-date (YYYY-MM-DD) helpers for inputs. Pure string math: no Date in local time, so
// the browser zone can never move a document date.

export type CalendarPart = 'day' | 'month' | 'year'

export function isValidCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function toCalendarDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function splitCalendarDate(value: string): { year: number; month: number; day: number } {
  const [y = '0', m = '0', d = '0'] = value.split('-')
  return { year: Number(y), month: Number(m), day: Number(d) }
}

/** Order of day/month/year in the locale's short numeric date ("tr-TR" -> day, month, year). */
export function datePartOrder(locale: string): CalendarPart[] {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date(Date.UTC(2026, 10, 22)))
    .map((p) => p.type)
    .filter((t): t is CalendarPart => t === 'day' || t === 'month' || t === 'year')
}

/**
 * Parses typed dates in the locale's order: "21.10.2026", "21/10/26", "21102026", "21.10"
 * (current year). Returns '' for empty input and null when the text is not a real date.
 */
export function parseCalendarInput(
  text: string,
  locale = 'tr-TR',
  referenceYear?: number,
): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  if (isValidCalendarDate(trimmed)) return trimmed
  const order = datePartOrder(locale)
  let groups = trimmed.split(/\D+/).filter(Boolean)
  if (groups.length === 1) {
    const digits = groups[0] ?? ''
    if (digits.length !== 8 && digits.length !== 6 && digits.length !== 4) return null
    const yearLength = digits.length === 8 ? 4 : 2
    groups = []
    let at = 0
    for (const part of order) {
      if (part === 'year' && digits.length === 4) continue
      const len = part === 'year' ? yearLength : 2
      groups.push(digits.slice(at, at + len))
      at += len
    }
  }
  const year = referenceYear ?? new Date().getUTCFullYear()
  const values: Partial<Record<CalendarPart, string>> = {}
  if (groups.length === 2) {
    const dm = order.filter((p) => p !== 'year')
    dm.forEach((p, i) => (values[p] = groups[i]))
    values.year = String(year)
  } else if (groups.length === 3) {
    order.forEach((p, i) => (values[p] = groups[i]))
  } else {
    return null
  }
  const { day = '', month = '' } = values
  let yearText = values.year ?? ''
  if (day.length > 2 || month.length > 2) return null
  if (yearText.length === 2) yearText = `20${yearText}`
  if (yearText.length !== 4) return null
  const iso = toCalendarDate(Number(yearText), Number(month), Number(day))
  return isValidCalendarDate(iso) ? iso : null
}

/** Weeks of a month view as calendar dates; null pads the days outside the month. */
export function monthMatrix(
  year: number,
  month: number,
  weekStartsOn: 0 | 1 = 1,
): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const lead = (first - weekStartsOn + 7) % 7
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= daysInMonth(year, month); d++) cells.push(toCalendarDate(year, month, d))
  while (cells.length % 7) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** Shifts a calendar date by whole days (keyboard navigation in the picker). */
export function addDays(value: string, delta: number): string {
  const { year, month, day } = splitCalendarDate(value)
  const date = new Date(Date.UTC(year, month - 1, day + delta))
  return toCalendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/** Form value of a date field whose typed text is not a usable date (malformed or out of range). */
export const INVALID_DATE = '#invalid-date'

export function inCalendarRange(value: string, min?: string, max?: string): boolean {
  return (min === undefined || value >= min) && (max === undefined || value <= max)
}

/** Nearest date inside [min, max]; ISO calendar strings compare correctly as text. */
export function clampCalendarDate(value: string, min?: string, max?: string): string {
  if (min !== undefined && value < min) return min
  if (max !== undefined && value > max) return max
  return value
}
