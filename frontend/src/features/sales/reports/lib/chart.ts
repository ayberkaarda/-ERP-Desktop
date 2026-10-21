import Decimal from 'decimal.js'
import { dec, isDecimal } from '../../invoices/kit/money'
import type { ChartDef, Row } from '../definitions'
import { stringAt } from './params'

export interface Bar {
  label: string
  value: string
  /** Share of the axis maximum in [0, 1] (absolute value; sign kept in `negative`). */
  ratio: number
  negative: boolean
}

/**
 * A "nice" axis maximum (1, 2, 2.5, 5 × 10^n) at or above `max`, and `count` even ticks. Only
 * the drawing uses numbers; values stay decimal strings everywhere else.
 */
export function niceScale(max: Decimal, count = 4): { max: Decimal; ticks: Decimal[] } {
  if (max.lessThanOrEqualTo(0))
    return { max: new Decimal(1), ticks: [0, 0.25, 0.5, 0.75, 1].map((x) => new Decimal(x)) }
  const rough = max.div(count)
  const exp = Math.floor(Math.log10(rough.toNumber()))
  const pow = new Decimal(10).pow(exp)
  const step =
    [1, 2, 2.5, 5, 10].map((m) => pow.mul(m)).find((s) => s.mul(count).greaterThanOrEqualTo(max)) ??
    pow.mul(10)
  const top = step.mul(count)
  return { max: top, ticks: Array.from({ length: count + 1 }, (_, i) => step.mul(i)) }
}

/** Ratio of a value to the axis max, clamped to [0, 1], for bar lengths. */
export function ratioOf(value: string, max: Decimal): number {
  if (max.isZero()) return 0
  const r = dec(value).abs().div(max).toNumber()
  return Math.min(1, Math.max(0, r))
}

/** Bars for column (rows in order) and bar (top rows by value, descending) charts. */
export function chartBars(
  def: ChartDef,
  rows: readonly Row[],
): { bars: Bar[]; max: Decimal; ticks: Decimal[] } {
  const key = def.values[0] ?? ''
  let picked = rows
    .map((r) => ({ label: stringAt(r, def.label), value: stringAt(r, key) }))
    .filter((b) => isDecimal(b.value))
  if (def.kind === 'bar') {
    picked = [...picked].sort((a, b) => dec(b.value).comparedTo(dec(a.value)))
    if (def.top) picked = picked.slice(0, def.top)
  }
  const largest = picked.reduce((m, b) => Decimal.max(m, dec(b.value).abs()), new Decimal(0))
  const { max, ticks } = def.kind === 'column' ? niceScale(largest) : { max: largest, ticks: [] }
  return {
    bars: picked.map((b) => ({
      ...b,
      ratio: ratioOf(b.value, max),
      negative: dec(b.value).isNegative(),
    })),
    max,
    ticks,
  }
}

export interface Segment {
  key: string
  value: string
  /** Share of the stacked total in [0, 1]. */
  share: number
}

/** Ageing buckets of the totals (or summed rows) as shares of their sum. */
export function stackedSegments(
  def: ChartDef,
  totals: Row | null,
  rows: readonly Row[],
): Segment[] {
  const values = def.values.map((key) => {
    const fromTotals = stringAt(totals, key)
    const v = isDecimal(fromTotals)
      ? dec(fromTotals)
      : rows.reduce((acc, r) => acc.plus(dec(stringAt(r, key))), new Decimal(0))
    return { key, value: v }
  })
  const sum = values.reduce((acc, v) => acc.plus(Decimal.max(v.value, 0)), new Decimal(0))
  return values.map((v) => ({
    key: v.key,
    value: v.value.toString(),
    share: sum.isZero() ? 0 : Decimal.max(v.value, 0).div(sum).toNumber(),
  }))
}
