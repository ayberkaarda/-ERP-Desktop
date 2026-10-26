import Decimal from 'decimal.js'
import { parseDecimal } from './parse'

export interface DecimalInputOptions {
  /** Digits kept after the separator; the value is rounded half-up to this scale. */
  scale: number
  locale?: string
  allowNegative?: boolean
}

/**
 * Form value of a decimal field whose typed text was rejected. Not a number, so decimalString()
 * fails it with `validation.number` and it can never be mistaken for an amount.
 */
export const INVALID_DECIMAL = '#invalid'

/** `value` is the canonical API string ("1234.50"), or '' for an empty field. */
export type DecimalParseResult = { ok: true; value: string } | { ok: false }

/** Turns what the user typed ("1.234,5") into the canonical string the API expects. */
export function parseDecimalInput(text: string, options: DecimalInputOptions): DecimalParseResult {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: '' }
  const parsed = parseDecimal(trimmed, options.locale ?? 'tr-TR')
  if (!parsed) return { ok: false }
  if (parsed.isNegative() && !parsed.isZero() && !options.allowNegative) return { ok: false }
  return {
    ok: true,
    value: parsed.toDecimalPlaces(options.scale, Decimal.ROUND_HALF_UP).toFixed(options.scale),
  }
}

export interface DecimalDisplayOptions {
  locale?: string
  minFraction?: number
  maxFraction?: number
  grouping?: boolean
}

/** Formats a canonical decimal string for reading ("1234.5" -> "1.234,50"); '' stays ''. */
export function formatDecimalDisplay(value: string, options: DecimalDisplayOptions = {}): string {
  if (value.trim() === '') return ''
  let decimal: Decimal
  try {
    decimal = new Decimal(value)
  } catch {
    return value
  }
  const min = options.minFraction ?? 2
  const max = Math.max(min, options.maxFraction ?? min)
  return new Intl.NumberFormat(options.locale ?? 'tr-TR', {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    useGrouping: options.grouping ?? true,
  }).format(
    decimal.toDecimalPlaces(max, Decimal.ROUND_HALF_UP).toFixed() as Intl.StringNumericLiteral,
  )
}

/** Text shown while editing: no grouping, locale separator, no trailing zeros ("1234,5"). */
export function toEditableText(value: string, locale = 'tr-TR'): string {
  if (value.trim() === '') return ''
  try {
    const plain = new Decimal(value).toFixed()
    return plain.replace('.', decimalSeparator(locale))
  } catch {
    return value
  }
}

export function decimalSeparator(locale = 'tr-TR'): string {
  return (
    new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.'
  )
}
