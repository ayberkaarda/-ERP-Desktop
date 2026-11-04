import { formatDate, formatDateTime } from '@/lib/datetime'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?(?:Z|[+-]00:?00)$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/

/** An ISO date or timestamp shown the way the locale writes it; anything else as is. */
export function localisedDate(value: string, locale: string): string {
  try {
    const midnight = ISO_MIDNIGHT.exec(value)
    if (ISO_DATE.test(value) || midnight) return formatDate(midnight?.[1] ?? value, locale)
    if (ISO_INSTANT.test(value)) return formatDateTime(value, locale)
  } catch {
    // not a real date (month 13, ...): show what was sent
  }
  return value
}
