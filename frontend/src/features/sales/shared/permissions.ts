import { anyOf } from '@/lib/permissions'

/** Permission names of the sales endpoints (PHASE5 "HTTP API"). */
export const SALES_PERMS = {
  quotes: {
    view: 'sales.quotes.view',
    create: 'sales.quotes.create',
    update: 'sales.quotes.update',
    delete: 'sales.quotes.delete',
  },
  orders: {
    view: 'sales.orders.view',
    create: 'sales.orders.create',
    update: 'sales.orders.update',
    delete: 'sales.orders.delete',
    approve: 'sales.orders.approve',
  },
  deliveriesCreate: 'sales.deliveries.create',
  invoicesCreate: 'sales.invoices.create',
  priceOverride: 'sales.price_override',
  creditOverride: 'sales.credit_override',
  stockView: 'inventory.stock.view',
  approvalsView: 'approvals.view',
} as const

const P = SALES_PERMS

/** What each screen or action needs; alternatives are expressed with anyOf. */
export const SALES_ACCESS = {
  quoteList: P.quotes.view,
  quoteNew: [P.quotes.view, P.quotes.create],
  /** Send, accept and reject change the quote's state. */
  quoteState: P.quotes.update,
  quoteRevise: P.quotes.create,
  /** Converting creates the order. */
  quoteConvert: P.orders.create,
  orderList: P.orders.view,
  orderNew: [P.orders.view, P.orders.create],
  orderConfirm: P.orders.update,
  orderRevise: P.orders.update,
  orderCancel: P.orders.update,
  createDelivery: P.deliveriesCreate,
  createInvoice: P.invoicesCreate,
  /** Exposure is read by anyone working with customer documents. */
  exposure: anyOf(P.quotes.view, P.orders.view, 'sales.invoices.view'),
  stockHint: P.stockView,
} as const

export const SALES_SECTION = anyOf(P.quotes.view, P.orders.view)
