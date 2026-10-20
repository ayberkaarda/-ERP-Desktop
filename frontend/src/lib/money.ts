import Decimal from 'decimal.js'

// API sends money as strings (numeric(20,4)); never round-trip through JS number.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export type MoneyInput = Decimal.Value

export function toDecimal(value: MoneyInput): Decimal {
  return new Decimal(value)
}

export function sum(values: readonly MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0))
}

export function formatMoney(
  value: MoneyInput,
  currency = 'TRY',
  locale = 'tr-TR',
  fractionDigits = 2,
): string {
  const fixed = toDecimal(value).toFixed(fractionDigits)
  // Intl accepts decimal strings without float conversion.
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(fixed as Intl.StringNumericLiteral)
}

export function formatDecimal(value: MoneyInput, fractionDigits = 2, locale = 'tr-TR'): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(toDecimal(value).toFixed(fractionDigits) as Intl.StringNumericLiteral)
}

/** Parses user input in the given locale ("1.234,56" in tr-TR) into a Decimal; null when invalid. */
export function parseDecimal(input: string, locale = 'tr-TR'): Decimal | null {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
  const group = parts.find((p) => p.type === 'group')?.value ?? ','
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.'
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Locales like tr-TR group with a space-like char; accept any whitespace as that separator.
  const g = /\s/.test(group) ? '\\s' : esc(group)
  const d = esc(decimal)
  // Either ungrouped digits or correctly grouped thousands; "1.2.3,45" is rejected, not coerced.
  const shape = new RegExp(`^-?(?:\\d+|\\d{1,3}(?:${g}\\d{3})+)(?:${d}\\d+)?$`)
  const trimmed = input.trim()
  if (!shape.test(trimmed)) return null
  const [intPart = '', fracPart] = trimmed.split(decimal)
  const normalized = intPart.replace(new RegExp(g, 'g'), '') + (fracPart ? `.${fracPart}` : '')
  return new Decimal(normalized)
}
