import Decimal from 'decimal.js'
import { dec, isDecimal, MONEY_SCALE } from '../../documents/lib/quantity'
import type { StockDocumentLine } from '../../documents/types'

/** Counted quantities being edited, by line id ('' = not counted). */
export type Counts = Record<string, string>

/**
 * A line the server has not confirmed yet: an offline `add` read back from the local queue
 * before it was pushed. It has no id (nor line_no / system quantity), so it cannot be counted
 * or referenced by a `counts` entry until the server answers; it is shown read-only.
 */
export function isPendingLine(line: StockDocumentLine): boolean {
  // The API type says string, but a locally projected line arrives without one.
  return !(line.id as string | undefined)
}

/** Counted quantity of a line: the edited value, or a pending line's own (read-only) value. */
export function countedOf(line: StockDocumentLine, counts: Counts): string {
  return isPendingLine(line) ? (line.counted_quantity ?? '') : (counts[line.id] ?? '')
}

export function initialCounts(lines: readonly StockDocumentLine[]): Counts {
  return Object.fromEntries(
    lines.filter((l) => !isPendingLine(l)).map((l) => [l.id, l.counted_quantity ?? '']),
  )
}

/** counted - system, or null while the line is not counted. */
export function lineVariance(line: StockDocumentLine, counted: string): Decimal | null {
  // A pending line's system quantity is only known once the server has added it.
  if (isPendingLine(line) || !isDecimal(counted)) return null
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
    const c = countedOf(l, counts)
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
    // Never sent: the server requires a line id, and an id-less entry would reject the batch.
    if (isPendingLine(l)) return []
    const now = counts[l.id] ?? ''
    const stored = l.counted_quantity ?? ''
    const same =
      now === stored || (isDecimal(now) && isDecimal(stored) && new Decimal(now).eq(stored))
    return same ? [] : [{ line_id: l.id, counted_quantity: now === '' ? null : now }]
  })
}

/** Fills the uncounted, editable lines with their system quantity. Pending lines are skipped. */
export function fillBlanks(lines: readonly StockDocumentLine[], counts: Counts): Counts {
  const next = { ...counts }
  for (const l of lines) {
    if (isPendingLine(l)) continue
    if ((next[l.id] ?? '') === '') next[l.id] = l.system_quantity ?? '0'
  }
  return next
}

/** Search and toggles of the count grid. */
export function filterLines(
  lines: readonly StockDocumentLine[],
  counts: Counts,
  options: { q: string; onlyVariance: boolean; onlyUncounted: boolean },
): StockDocumentLine[] {
  const needle = options.q.trim().toLocaleLowerCase('tr')
  return lines.filter((l) => {
    const c = countedOf(l, counts)
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
