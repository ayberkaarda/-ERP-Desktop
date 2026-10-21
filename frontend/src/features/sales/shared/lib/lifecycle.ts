import { deliverableQuantity, invoiceableQuantity } from './fulfilment'
import { dec } from './lines'
import type { OrderStatus, QuoteStatus, SalesOrderLine } from '../types'

export type QuoteAction = 'edit' | 'delete' | 'send' | 'accept' | 'reject' | 'convert' | 'revise'

/** Actions the quote state machine offers in each status (the server re-checks every one). */
export function quoteActions(status: QuoteStatus): QuoteAction[] {
  switch (status) {
    case 'draft':
      return ['edit', 'delete', 'send']
    case 'sent':
      return ['accept', 'reject', 'convert', 'revise']
    case 'accepted':
      return ['convert']
    case 'rejected':
    case 'expired':
      return ['revise']
    default:
      return []
  }
}

export type OrderAction =
  'edit' | 'delete' | 'confirm' | 'revise' | 'cancel' | 'createDelivery' | 'createInvoice'

const FULFILLING: readonly OrderStatus[] = [
  'confirmed',
  'partially_delivered',
  'delivered',
  'partially_invoiced',
]

export function hasDeliveries(lines: readonly SalesOrderLine[]): boolean {
  return lines.some((l) => dec(l.delivered_quantity).gt(0))
}

export function hasInvoices(lines: readonly SalesOrderLine[]): boolean {
  return lines.some((l) => dec(l.invoiced_quantity).gt(0))
}

/**
 * Actions of an order: revise only before any delivery; cancel while nothing was delivered or
 * invoiced; delivery while some quantity is left to deliver; invoice while something is left to
 * invoice (service lines and deliver-on-invoice are checked in the wizard).
 */
export function orderActions(order: {
  status: OrderStatus
  lines: SalesOrderLine[]
  over_delivery_percent?: string | null
}): OrderAction[] {
  const { status, lines } = order
  const over = order.over_delivery_percent ?? '0'
  if (status === 'draft') return ['edit', 'delete', 'confirm', 'cancel']
  if (status === 'pending_approval') return ['cancel']
  // A fully invoiced order may still hold delivered quantity beyond the order (tolerance).
  if (status === 'invoiced')
    return lines.some((l) => invoiceableQuantity(l).gt(0)) ? ['createInvoice'] : []
  if (!FULFILLING.includes(status)) return []
  const out: OrderAction[] = []
  const delivered = hasDeliveries(lines)
  if (status === 'confirmed' && !delivered) out.push('revise')
  if (!delivered && !hasInvoices(lines)) out.push('cancel')
  // Same bounds as the wizard: tolerance for deliveries, delivered or deliver-on-invoice for invoices.
  if (lines.some((l) => deliverableQuantity(l, over).gt(0))) out.push('createDelivery')
  if (lines.some((l) => invoiceableQuantity(l).gt(0) || invoiceableQuantity(l, true).gt(0)))
    out.push('createInvoice')
  return out
}
