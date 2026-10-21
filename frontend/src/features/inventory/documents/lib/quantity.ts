import Decimal from 'decimal.js'

/** Canonical API decimal ("12", "12.500000", "-3.5"). */
export const CANONICAL = /^-?\d+(?:\.\d+)?$/

/** Decimal of a form or API string; empty or malformed text counts as zero. */
export function dec(value: string | null | undefined): Decimal {
  return typeof value === 'string' && CANONICAL.test(value.trim())
    ? new Decimal(value.trim())
    : new Decimal(0)
}

export function isDecimal(value: string | null | undefined): value is string {
  return typeof value === 'string' && CANONICAL.test(value.trim())
}

/** Quantity in the item's base unit (scale 6, numeric(20,6)), or null when not computable. */
export function baseQuantity(quantity: string, factor: string): string | null {
  if (!isDecimal(quantity) || !isDecimal(factor)) return null
  return new Decimal(quantity)
    .mul(new Decimal(factor))
    .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
    .toFixed(6)
}

/** Line cost rounded half-up to 2 (document totals add rounded line amounts). */
export function lineCost(quantity: string, unitCost: string): Decimal | null {
  if (!isDecimal(quantity) || !isDecimal(unitCost)) return null
  return new Decimal(quantity).mul(unitCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}

/** Strips trailing zeros of a canonical decimal for display-free comparisons ("1.500000" -> "1.5"). */
export function trimDecimal(value: string): string {
  return isDecimal(value) ? new Decimal(value).toString() : value
}

/** Factor of a stored line: base quantity / quantity (1 when it cannot be derived). */
export function factorOf(quantity: string, base: string): string {
  const q = dec(quantity)
  if (q.isZero() || !isDecimal(base)) return '1'
  return new Decimal(base).div(q).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString()
}

export function isInteger(value: string): boolean {
  return isDecimal(value) && new Decimal(value).isInteger()
}
