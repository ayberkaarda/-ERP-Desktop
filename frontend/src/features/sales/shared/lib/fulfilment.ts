import Decimal from 'decimal.js'
import { createKeyStore } from './idempotency'
import { CANONICAL, dec } from './lines'
import type { SalesOrderLine } from '../types'

export type FulfilmentMode = 'delivery' | 'invoice'

const max0 = (d: Decimal) => (d.isNegative() ? new Decimal(0) : d)

/** Left to deliver, plus the over-delivery tolerance (percent of the ordered quantity). */
export function deliverableQuantity(line: SalesOrderLine, overPercent = '0'): Decimal {
  const ordered = dec(line.quantity)
  const tolerance = ordered.mul(dec(overPercent)).div(100)
  return max0(ordered.plus(tolerance).minus(dec(line.delivered_quantity))).toDecimalPlaces(6)
}

/**
 * Left to invoice: stock lines up to what was delivered; service lines (and stock lines when
 * the invoice posts the delivery itself) up to the ordered quantity.
 */
export function invoiceableQuantity(line: SalesOrderLine, deliverOnInvoice = false): Decimal {
  const service = line.item_type === 'service'
  const delivered = dec(line.delivered_quantity)
  // Deliver-on-invoice can reach the ordered quantity, or what was already delivered beyond it.
  const ceiling =
    service || deliverOnInvoice ? Decimal.max(dec(line.quantity), delivered) : delivered
  return max0(ceiling.minus(dec(line.invoiced_quantity))).toDecimalPlaces(6)
}

/** Stock lines with quantity left that only deliver-on-invoice can invoice now. */
export function needsDeliverOnInvoice(lines: readonly SalesOrderLine[]): boolean {
  return lines.some(
    (l) =>
      l.item_type !== 'service' &&
      dec(l.quantity).gt(dec(l.delivered_quantity)) &&
      dec(l.quantity).gt(dec(l.invoiced_quantity)),
  )
}

export function remainingFor(
  mode: FulfilmentMode,
  line: SalesOrderLine,
  options: { overPercent?: string; deliverOnInvoice?: boolean } = {},
): Decimal {
  return mode === 'delivery'
    ? deliverableQuantity(line, options.overPercent)
    : invoiceableQuantity(line, options.deliverOnInvoice)
}

export type QuantityProblem = 'invalid' | 'scale' | 'exceeds' | null

/** Problem of a typed quantity against its bound ('' and 0 mean "skip this line"). */
export function quantityProblem(value: string, bound: Decimal): QuantityProblem {
  const v = value.trim()
  if (v === '') return null
  if (!CANONICAL.test(v) || new Decimal(v).isNegative()) return 'invalid'
  const d = new Decimal(v)
  if (d.decimalPlaces() > 6) return 'scale'
  return d.gt(bound) ? 'exceeds' : null
}

/** Body lines: only quantities > 0, in order-line terms. */
export function fulfilmentLines(
  quantities: Record<string, string>,
): { order_line_id: string; quantity: string }[] {
  return Object.entries(quantities)
    .filter(([, q]) => CANONICAL.test(q.trim()) && new Decimal(q.trim()).gt(0))
    .map(([id, q]) => ({ order_line_id: id, quantity: q.trim() }))
}

/** Keys of delivery/invoice creations (company + order + mode + body), outliving the wizard. */
export const fulfilmentKeys = createKeyStore()
