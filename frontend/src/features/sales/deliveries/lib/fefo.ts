import Decimal from 'decimal.js'
import { dec, isDecimal } from '../../invoices/kit/money'
import { MAX_LINES } from '../../invoices/kit/types'
import type { LotStock } from '../types'
import { applyAllocations, takenByOthers, type DeliveryLineValues } from './lines'

export interface LotAllocation {
  lot_no: string
  expiry_date: string | null
  quantity: string
}

export interface FefoResult {
  allocations: LotAllocation[]
  /** Quantity no lot could cover ("0" when fully allocated). */
  shortage: string
  /** Expired lots left out (they need the expired-issue override in Inventory). */
  skippedExpired: number
}

/** Usable quantity of a lot: `available` when the API reports it, else on hand. */
export function lotAvailable(lot: LotStock): Decimal {
  const v = isDecimal(lot.available ?? null) ? dec(lot.available) : dec(lot.on_hand)
  return v.isNegative() ? new Decimal(0) : v
}

/** First expiry first: dated lots by expiry, then undated ones, ties by lot number. */
export function fefoOrder(lots: readonly LotStock[]): LotStock[] {
  return [...lots].sort((a, b) => {
    if (a.expiry_date !== b.expiry_date) {
      if (a.expiry_date === null) return 1
      if (b.expiry_date === null) return -1
      return a.expiry_date < b.expiry_date ? -1 : 1
    }
    return a.lot_no.localeCompare(b.lot_no, 'tr')
  })
}

/**
 * Splits `quantity` over the lots in FEFO order, skipping expired lots (expiry before `today`)
 * and quantities already taken by other lines of the document (`taken` per lot number).
 */
export function allocateFefo(
  lots: readonly LotStock[],
  quantity: string,
  today: string,
  taken: Readonly<Record<string, string>> = {},
): FefoResult {
  let left = dec(quantity)
  const allocations: LotAllocation[] = []
  let skippedExpired = 0
  for (const lot of fefoOrder(lots)) {
    if (left.lessThanOrEqualTo(0)) break
    if (lot.expiry_date !== null && lot.expiry_date < today) {
      skippedExpired++
      continue
    }
    const free = lotAvailable(lot).minus(dec(taken[lot.lot_no] ?? '0'))
    if (free.lessThanOrEqualTo(0)) continue
    const take = Decimal.min(free, left)
    allocations.push({
      lot_no: lot.lot_no,
      expiry_date: lot.expiry_date,
      quantity: take.toString(),
    })
    left = left.minus(take)
  }
  return {
    allocations,
    shortage: left.greaterThan(0) ? left.toString() : '0',
    skippedExpired,
  }
}

/** What a FEFO request was made for: the row and the inputs the answer depends on. */
export interface FefoRequest {
  rowKey: string
  itemId: string
  quantity: string
  lotNo: string
  lineWarehouseId: string
  headerWarehouseId: string
}

export function fefoRequestFor(
  lines: readonly DeliveryLineValues[],
  index: number,
  headerWarehouseId: string,
): FefoRequest | null {
  const line = lines[index]
  if (!line) return null
  return {
    rowKey: line.rowKey,
    itemId: line.itemId,
    quantity: line.quantity,
    lotNo: line.lotNo,
    lineWarehouseId: line.warehouseId,
    headerWarehouseId,
  }
}

export type FefoPlan =
  | { kind: 'stale' }
  | { kind: 'none'; result: FefoResult }
  | { kind: 'tooMany'; count: number }
  | { kind: 'ok'; lines: DeliveryLineValues[]; result: FefoResult }

/**
 * Applies a lots answer to the lines as they are now: only if the requested row still exists with
 * the same item, quantity, lot and warehouse; only that row is split (other rows keep their latest
 * values); a split that would exceed `max` lines is refused instead of truncated.
 */
export function planFefo(
  current: readonly DeliveryLineValues[],
  headerWarehouseId: string,
  req: FefoRequest,
  lots: readonly LotStock[],
  today: string,
  max = MAX_LINES,
): FefoPlan {
  const index = current.findIndex((l) => l.rowKey === req.rowKey)
  const line = current[index]
  if (!line) return { kind: 'stale' }
  if (
    line.itemId !== req.itemId ||
    line.quantity !== req.quantity ||
    line.lotNo !== req.lotNo ||
    line.warehouseId !== req.lineWarehouseId ||
    (line.warehouseId === '' && headerWarehouseId !== req.headerWarehouseId)
  )
    return { kind: 'stale' }
  const result = allocateFefo(lots, line.quantity, today, takenByOthers(current, index))
  if (result.allocations.length === 0) return { kind: 'none', result }
  const lines = applyAllocations(current, index, result.allocations, result.shortage)
  if (lines.length > max) return { kind: 'tooMany', count: lines.length }
  return { kind: 'ok', lines, result }
}
