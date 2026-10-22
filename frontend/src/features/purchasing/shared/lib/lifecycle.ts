import Decimal from 'decimal.js'
import { createKeyStore } from '@/features/sales/shared/lib/idempotency'
import type {
  OrderLine,
  OrderStatus,
  PurchaseLink,
  RequestLine,
  RequestStatus,
  RfqStatus,
} from '../types'
import { dec } from './forms'

export { fulfilmentLines, quantityProblem } from '@/features/sales/shared/lib/fulfilment'
export type { QuantityProblem } from '@/features/sales/shared/lib/fulfilment'

const max0 = (d: Decimal) => (d.isNegative() ? new Decimal(0) : d)

// ---- requests ----------------------------------------------------------------------------

export type RequestAction = 'edit' | 'delete' | 'submit' | 'cancel' | 'toRfq' | 'toOrder'

/** Left to order on a request line (drafts of orders already hold their quantity). */
export const openOnRequest = (l: RequestLine) => max0(dec(l.quantity).minus(dec(l.ordered)))

/** Actions of the request state machine (RequestService); the server re-checks every one. */
export function requestActions(status: RequestStatus, lines: readonly RequestLine[]) {
  const out: RequestAction[] = []
  if (status === 'draft') out.push('edit', 'delete', 'submit', 'cancel')
  else if (status === 'rejected') out.push('edit', 'cancel')
  else if (status === 'pending_approval') out.push('cancel')
  else if (status === 'approved' || status === 'partially_ordered') {
    if (lines.some((l) => openOnRequest(l).gt(0))) out.push('toRfq', 'toOrder')
    out.push('cancel')
  }
  return out
}

// ---- RFQs --------------------------------------------------------------------------------

export type RfqAction = 'edit' | 'delete' | 'send' | 'cancel' | 'quotes' | 'award'

export function rfqActions(status: RfqStatus, quoteCount: number): RfqAction[] {
  if (status === 'draft') return ['edit', 'delete', 'send', 'cancel']
  if (status === 'sent' || status === 'collecting')
    return quoteCount > 0 ? ['quotes', 'award', 'cancel'] : ['quotes', 'cancel']
  return []
}

// ---- orders ------------------------------------------------------------------------------

export type OrderAction =
  | 'edit'
  | 'delete'
  | 'submit'
  | 'send'
  | 'revise'
  | 'cancel'
  | 'close'
  | 'createReceipt'
  | 'createInvoice'

/** Approved and not finished (OrderStatus::open): receipts and invoices may be created. */
export const OPEN_ORDER: readonly OrderStatus[] = [
  'approved',
  'sent',
  'partially_received',
  'received',
  'partially_invoiced',
]

const isService = (l: OrderLine) => l.item_type === 'service'

/** Receipts or invoices exist (any status the viewer can see, or quantities moved). */
export function orderHasDocuments(lines: readonly OrderLine[], links: readonly PurchaseLink[]) {
  return (
    lines.some((l) => dec(l.received_quantity).gt(0) || dec(l.invoiced_quantity).gt(0)) ||
    links.some((l) => l.type === 'purchase_receipt' || l.type === 'purchase_invoice')
  )
}

/**
 * Left to receive on a stock line: the ordered quantity plus the over-receipt tolerance, less
 * what was received. `null` tolerance (setting not readable): unbounded here, the server answers.
 */
export function receivableQuantity(line: OrderLine, overPercent: string | null = '0'): Decimal {
  if (isService(line)) return new Decimal(0)
  if (overPercent === null) return new Decimal(Infinity)
  const ordered = dec(line.quantity)
  const allowed = ordered.plus(ordered.mul(dec(overPercent)).div(100))
  return max0(allowed.minus(dec(line.received_quantity))).toDecimalPlaces(6, Decimal.ROUND_DOWN)
}

/** What is left of the order itself (wizard default, without tolerance). */
export function unreceivedQuantity(line: OrderLine): Decimal {
  if (isService(line)) return new Decimal(0)
  return max0(dec(line.quantity).minus(dec(line.received_quantity)))
}

/**
 * Left to invoice: stock lines up to what was received (or the ordered quantity when the invoice
 * receives the goods itself); service lines up to the ordered quantity.
 */
export function invoiceableQuantity(line: OrderLine, receiveOnInvoice = false): Decimal {
  const received = dec(line.received_quantity)
  const ceiling =
    isService(line) || receiveOnInvoice ? Decimal.max(dec(line.quantity), received) : received
  return max0(ceiling.minus(dec(line.invoiced_quantity))).toDecimalPlaces(6)
}

/** Stock lines that only receive-on-invoice can invoice now. */
export function needsReceiveOnInvoice(lines: readonly OrderLine[]): boolean {
  return lines.some(
    (l) =>
      !isService(l) &&
      dec(l.quantity).gt(dec(l.received_quantity)) &&
      dec(l.quantity).gt(dec(l.invoiced_quantity)),
  )
}

/**
 * Actions of an order. `overReceiptPercent` (purchasing.allow_over_receipt_percent) keeps the
 * receipt action while the tolerance still allows quantity; null (not readable) falls back to
 * what is left of the order.
 */
export function orderActions(
  order: {
    status: OrderStatus
    lines: readonly OrderLine[]
    links: readonly PurchaseLink[]
  },
  overReceiptPercent: string | null = null,
): OrderAction[] {
  const { status, lines, links } = order
  const untouched = !orderHasDocuments(lines, links)
  if (status === 'draft') return ['edit', 'delete', 'submit', 'cancel']
  if (status === 'pending_approval') return untouched ? ['revise', 'cancel'] : ['cancel']
  if (status === 'invoiced') return ['close']
  if (!OPEN_ORDER.includes(status)) return []
  const out: OrderAction[] = []
  if (status === 'approved') out.push('send')
  if ((status === 'approved' || status === 'sent') && untouched) out.push('revise', 'cancel')
  const receivable = (l: OrderLine) =>
    overReceiptPercent === null ? unreceivedQuantity(l) : receivableQuantity(l, overReceiptPercent)
  if (lines.some((l) => receivable(l).gt(0))) out.push('createReceipt')
  if (lines.some((l) => invoiceableQuantity(l).gt(0) || invoiceableQuantity(l, true).gt(0)))
    out.push('createInvoice')
  out.push('close')
  return out
}

export type WizardMode = 'receipt' | 'invoice'

/** Bound of a wizard line (Infinity = unknown tolerance: the server checks it). */
export function wizardBound(
  mode: WizardMode,
  line: OrderLine,
  overReceiptPercent: string | null,
  receiveOnInvoice: boolean,
): Decimal {
  return mode === 'receipt'
    ? receivableQuantity(line, overReceiptPercent)
    : invoiceableQuantity(line, receiveOnInvoice)
}

/** Keys of receipt / invoice creations (company + order + mode + body), outliving the wizard. */
export const wizardKeys = createKeyStore()

/** Keys of conversions started from dialogs (request -> RFQ / order, RFQ award). */
export const conversionKeys = createKeyStore()
