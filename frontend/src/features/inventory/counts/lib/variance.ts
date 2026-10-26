import Decimal from 'decimal.js'
import { dec, isDecimal, MONEY_SCALE } from '../../documents/lib/quantity'
import type { StockDocumentLine } from '../../documents/types'

/** Counted quantities being edited, by line id ('' = not counted). */
export type Counts = Record<string, string>

export function initialCounts(lines: readonly StockDocumentLine[]): Counts {
  return Object.fromEntries(lines.map((l) => [l.id, l.counted_quantity ?? '']))
}

/** counted - system, or null while the line is not counted. */
export function lineVariance(line: StockDocumentLine, counted: string): Decimal | null {
  if (!isDecimal(counted)) return null
  return new Decimal(counted).minus(dec(line.system_quantity))
}

/** Cost a count line is valued at: its own cost if given, else the current moving average. */
export function countCost(line: StockDocumentLine): string | null {
  return line.unit_cost ?? line.avg_cost ?? null
}

/** Variance valued at the average cost, at the money scale (rounded to 2 only for display). */
export function varianceValue(line: StockDocumentLine, counted: string): Decimal | null {
  const v = lineVariance(line, counted)
  if (v === null) return null
  return v.mul(dec(countCost(line))).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP)
}

export interface CountSummary {
  total: number
  counted: number
  /** Lines whose counted quantity differs from the system quantity. */
  differing: number
  gain: string
  loss: string
  net: string
}

export function countSummary(lines: readonly StockDocumentLine[], counts: Counts): CountSummary {
  let gain = new Decimal(0)
  let loss = new Decimal(0)
  let counted = 0
  let differing = 0
  for (const l of lines) {
    const c = counts[l.id] ?? ''
    if (!isDecimal(c)) continue
    counted += 1
    const v = lineVariance(l, c)
    if (v && !v.isZero()) differing += 1
    const value = varianceValue(l, c) ?? new Decimal(0)
    if (value.isPositive() && !value.isZero()) gain = gain.plus(value)
    if (value.isNegative()) loss = loss.plus(value.abs())
  }
  return {
    total: lines.length,
    counted,
    differing,
    gain: gain.toFixed(MONEY_SCALE),
    loss: loss.toFixed(MONEY_SCALE),
    net: gain.minus(loss).toFixed(MONEY_SCALE),
  }
}

/** Lines whose count changed against the stored document (what a save sends). */
export function changedCounts(
  lines: readonly StockDocumentLine[],
  counts: Counts,
): { line_id: string; counted_quantity: string | null }[] {
  return lines.flatMap((l) => {
    const now = counts[l.id] ?? ''
    const stored = l.counted_quantity ?? ''
    const same =
      now === stored || (isDecimal(now) && isDecimal(stored) && new Decimal(now).eq(stored))
    return same ? [] : [{ line_id: l.id, counted_quantity: now === '' ? null : now }]
  })
}

/** Search and toggles of the count grid. */
export function filterLines(
  lines: readonly StockDocumentLine[],
  counts: Counts,
  options: { q: string; onlyVariance: boolean; onlyUncounted: boolean },
): StockDocumentLine[] {
  const needle = options.q.trim().toLocaleLowerCase('tr')
  return lines.filter((l) => {
    const c = counts[l.id] ?? ''
    if (options.onlyUncounted && isDecimal(c)) return false
    if (options.onlyVariance) {
      const v = lineVariance(l, c)
      if (!v || v.isZero()) return false
    }
    if (!needle) return true
    return [l.item_code, l.item_name, l.lot_no, l.location_code].some((x) =>
      x?.toLocaleLowerCase('tr').includes(needle),
    )
  })
}
