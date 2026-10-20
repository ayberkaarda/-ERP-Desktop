// Two kinds of values: calendar dates ("2026-10-21", e.g. invoice date) never shift with a
// time zone; instants (ISO timestamps) are shown in the business zone.
export const DEFAULT_TIME_ZONE = 'Europe/Istanbul'

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isCalendarDate(value: string): boolean {
  return CALENDAR_DATE.test(value)
}

function calendarToUtc(value: string): Date {
  const m = CALENDAR_DATE.exec(value)
  if (!m) throw new RangeError(`Not a calendar date: ${value}`)
  const [, y, mo, d] = m.map(Number) as [number, number, number, number]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    throw new RangeError(`Invalid calendar date: ${value}`)
  }
  return date
}

const DATE_PARTS: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }

/**
 * Formats a calendar date ("YYYY-MM-DD") as-is, or the calendar day of an instant in `timeZone`.
 */
export function formatDate(value: Date | string, locale = 'tr-TR', timeZone = DEFAULT_TIME_ZONE) {
  if (typeof value === 'string' && isCalendarDate(value)) {
    return new Intl.DateTimeFormat(locale, { ...DATE_PARTS, timeZone: 'UTC' }).format(
      calendarToUtc(value),
    )
  }
  return new Intl.DateTimeFormat(locale, { ...DATE_PARTS, timeZone }).format(toInstant(value))
}

/** Formats an instant in `timeZone`. Calendar dates are rejected: they have no time of day. */
export function formatDateTime(
  value: Date | string,
  locale = 'tr-TR',
  timeZone = DEFAULT_TIME_ZONE,
) {
  return new Intl.DateTimeFormat(locale, {
    ...DATE_PARTS,
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(toInstant(value))
}

/** Calendar date (YYYY-MM-DD) of the given instant in the business zone. */
export function toIsoDate(value: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(value)
}

function toInstant(value: Date | string): Date {
  if (value instanceof Date) return value
  if (isCalendarDate(value)) throw new RangeError(`Calendar date is not an instant: ${value}`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid instant: ${value}`)
  return date
}

export * from './calendar'
export { intlLocale, useIntlLocale } from './locale'
