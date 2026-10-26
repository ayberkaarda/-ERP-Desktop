import Decimal from 'decimal.js'
import { formatDecimalDisplay } from '@/lib/money'

/** Canonical API decimal ("12", "12.500000", "-3.5"). */
export const CANONICAL = /^-?\d+(?:\.\d+)?$/

export function isDecimal(value: string | null | undefined): value is string {
  return typeof value === 'string' && CANONICAL.test(value.trim())
}

/** Decimal of a form or API string; empty or malformed text counts as zero. */
export function dec(value: string | null | undefined): Decimal {
  return isDecimal(value) ? new Decimal(value.trim()) : new Decimal(0)
}

/** Strips trailing zeros ("1.500000" -> "1.5"); other text is returned unchanged. */
export function trimDecimal(value: string): string {
  return isDecimal(value) ? new Decimal(value).toString() : value
}

/** Smaller of two decimal strings, as a trimmed string. */
export function minDecimal(a: string, b: string): string {
  return Decimal.min(dec(a), dec(b)).toString()
}

/** Money for reading: 2 decimals, locale grouping, optional ISO currency suffix. */
export function money(value: string | null | undefined, locale: string, currency?: string | null) {
  if (!isDecimal(value)) return ''
  const text = formatDecimalDisplay(value, { locale })
  return currency ? `${text} ${currency}` : text
}

/** Quantity for reading: up to 6 decimals, trailing zeros dropped. */
export function qty(value: string | null | undefined, locale: string) {
  if (!isDecimal(value)) return ''
  return formatDecimalDisplay(trimDecimal(value), { locale, minFraction: 0, maxFraction: 6 })
}

/** Percentage for reading ("18" -> "%18", "12.5" -> "%12,5"). */
export function percent(value: string | null | undefined, locale: string) {
  if (!isDecimal(value)) return ''
  return `%${formatDecimalDisplay(trimDecimal(value), { locale, minFraction: 0, maxFraction: 2 })}`
}
