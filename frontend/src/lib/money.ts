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
  const normalized = input.trim().replace(/\s/g, '').split(group).join('').replace(decimal, '.')
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  return new Decimal(normalized)
}
