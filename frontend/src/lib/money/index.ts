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

/**
 * Document rounding rule: each line amount (quantity × unit price) is rounded half-up to the
 * currency scale first, and document totals are the sum of those rounded line amounts. The
 * total therefore always equals the sum of the amounts printed on the lines.
 */
export function lineAmount(quantity: MoneyInput, unitPrice: MoneyInput, scale = 2): Decimal {
  return toDecimal(quantity).mul(unitPrice).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP)
}

/** Sum of already-rounded line amounts (see lineAmount). */
export function documentTotal(
  lines: readonly { quantity: MoneyInput; unitPrice: MoneyInput }[],
  scale = 2,
): Decimal {
  return sum(lines.map((l) => lineAmount(l.quantity, l.unitPrice, scale)))
}

export { parseDecimal } from './parse'
export * from './input'
