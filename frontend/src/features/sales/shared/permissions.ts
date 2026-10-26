import { anyOf } from '@/lib/permissions'

/** Permission names of the sales endpoints (backend Modules/Sales/permissions.php). */
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
  invoicesView: 'sales.invoices.view',
  priceOverride: 'sales.price_override',
  creditOverride: 'sales.credit_override',
  stockView: 'inventory.stock.view',
  approvalsView: 'approvals.view',
  settingsView: 'settings.view',
} as const

const P = SALES_PERMS

/** What each screen or action needs (arrays = all of them; alternatives use anyOf). */
export const SALES_ACCESS = {
  quoteList: P.quotes.view,
  quoteNew: [P.quotes.view, P.quotes.create],
  /** Send, accept, reject, revise and cancel are edits of the quote (QuotePolicy). */
  quoteState: P.quotes.update,
  quoteRevise: P.quotes.update,
  /** Converting edits the quote and creates the order. */
  quoteConvert: [P.quotes.update, P.orders.create],
  orderList: P.orders.view,
  orderNew: [P.orders.view, P.orders.create],
  /** confirm, revise and close need approve (OrderPolicy); cancel is an edit. */
  orderConfirm: P.orders.approve,
  orderRevise: P.orders.approve,
  orderClose: P.orders.approve,
  orderCancel: P.orders.update,
  /** Conversions need the target's create and the order's view. */
  createDelivery: [P.deliveriesCreate, P.orders.view],
  createInvoice: [P.invoicesCreate, P.orders.view],
  /** GET /customers/{id}/exposure: any of quotes/orders/invoices view. */
  exposure: anyOf(P.quotes.view, P.orders.view, P.invoicesView),
  stockHint: P.stockView,
} as const

export const SALES_SECTION = anyOf(P.quotes.view, P.orders.view)
