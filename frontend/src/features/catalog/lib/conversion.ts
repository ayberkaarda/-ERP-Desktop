import Decimal from 'decimal.js'
import type { UnitConversion } from '../types'

// Quantities and factors are numeric(20,6) on the API: strings in, strings out, never floats.
export const QTY_SCALE = 6
const CANONICAL = /^-?\d+(?:\.\d+)?$/

export function isDecimalString(value: string | null | undefined): value is string {
  return typeof value === 'string' && CANONICAL.test(value)
}

export function isPositiveFactor(value: string | null | undefined): boolean {
  return isDecimalString(value) && new Decimal(value).greaterThan(0)
}

/** Trailing zeros dropped ("12.500000" -> "12.5"); keeps the API scale. */
export function normalize(value: Decimal.Value, scale = QTY_SCALE): string {
  return new Decimal(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed()
}

/** qty × factor, e.g. 3 boxes × 12 = 36 pieces. Null when an input is not a number. */
export function convertQty(qty: string, factor: string, scale = QTY_SCALE): string | null {
  if (!isDecimalString(qty) || !isDecimalString(factor)) return null
  return normalize(new Decimal(qty).times(factor), scale)
}

/** Largest value numeric(20,6) holds: 14 integer digits, 6 fraction digits. */
export const MAX_QTY = '99999999999999.999999'

export type FactorProblem = 'number' | 'scale' | 'positive' | 'max'

/** Why a factor string cannot be stored (null when it can); safe on any input. */
export function factorProblem(value: string): FactorProblem | null {
  if (!isDecimalString(value)) return 'number'
  const d = new Decimal(value)
  if (d.decimalPlaces() > QTY_SCALE) return 'scale'
  if (!d.greaterThan(0)) return 'positive'
  if (d.greaterThan(MAX_QTY)) return 'max'
  return null
}

/**
 * 1 / factor for display, the reverse direction of a conversion. Six significant digits, so a
 * large factor (10 000 000) still shows a non-zero reciprocal (0.0000001).
 */
export function inverseFactor(factor: string): string | null {
  if (!isPositiveFactor(factor)) return null
  return new Decimal(1).dividedBy(factor).toSignificantDigits(6, Decimal.ROUND_HALF_UP).toFixed()
}

/** Fraction digits of a canonical decimal string (display precision for previews). */
export function fractionDigits(value: string): number {
  const dot = value.indexOf('.')
  return dot < 0 ? 0 : value.length - dot - 1
}

export const pairKey = (from: string, to: string) => `${from}>${to}`

export interface MatrixCell {
  /** Stored row for this exact direction. */
  conversion?: UnitConversion
  /** Shown when only the opposite direction is stored. */
  implied?: string
}

/** Cells keyed by from>to: the stored factor, or the inverse of the opposite row. */
export function conversionMatrix(conversions: readonly UnitConversion[]): Map<string, MatrixCell> {
  const out = new Map<string, MatrixCell>()
  for (const c of conversions) {
    out.set(pairKey(c.from_unit_id, c.to_unit_id), {
      ...out.get(pairKey(c.from_unit_id, c.to_unit_id)),
      conversion: c,
    })
  }
  for (const c of conversions) {
    const reverse = pairKey(c.to_unit_id, c.from_unit_id)
    const cell = out.get(reverse)
    if (cell?.conversion) continue
    const implied = inverseFactor(c.factor)
    if (implied) out.set(reverse, { ...cell, implied })
  }
  return out
}

export type MatrixChange =
  | { kind: 'create'; from: string; to: string; factor: string }
  | { kind: 'update'; conversion: UnitConversion; factor: string }
  | { kind: 'delete'; conversion: UnitConversion }

/** Turns edited cells (from>to -> text value) into API operations; '' clears a stored row. */
export function diffMatrix(
  conversions: readonly UnitConversion[],
  edits: Readonly<Record<string, string>>,
): MatrixChange[] {
  const stored = new Map(conversions.map((c) => [pairKey(c.from_unit_id, c.to_unit_id), c]))
  const changes: MatrixChange[] = []
  for (const [key, value] of Object.entries(edits)) {
    const [from, to] = key.split('>')
    if (!from || !to || from === to) continue
    const existing = stored.get(key)
    // Drafts that are not numbers yet (the input's invalid marker) are not operations.
    if (value !== '' && !isDecimalString(value)) continue
    if (value === '') {
      if (existing) changes.push({ kind: 'delete', conversion: existing })
      continue
    }
    if (!existing) changes.push({ kind: 'create', from, to, factor: value })
    else if (!new Decimal(existing.factor).equals(value))
      changes.push({ kind: 'update', conversion: existing, factor: value })
  }
  return changes
}
