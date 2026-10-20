// Business dates are calendar dates in the company's zone, not instants.
export const DEFAULT_TIME_ZONE = 'Europe/Istanbul'

function toDate(value: Date | string): Date {
  return typeof value === 'string' ? new Date(value) : value
}

export function formatDate(value: Date | string, locale = 'tr-TR', timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone,
  }).format(toDate(value))
}

export function formatDateTime(
  value: Date | string,
  locale = 'tr-TR',
  timeZone = DEFAULT_TIME_ZONE,
) {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(toDate(value))
}

/** ISO calendar date (YYYY-MM-DD) for the given instant in the business zone. */
export function toIsoDate(value: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(value)
}
