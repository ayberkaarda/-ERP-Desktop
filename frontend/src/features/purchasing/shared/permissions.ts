import { anyOf } from '@/lib/permissions'

/** Permission names of the purchasing endpoints (backend Modules/Purchasing/permissions.php). */
export const PURCH_PERMS = {
  requests: {
    view: 'purchasing.requests.view',
    create: 'purchasing.requests.create',
    update: 'purchasing.requests.update',
    delete: 'purchasing.requests.delete',
  },
  rfqs: {
    view: 'purchasing.rfqs.view',
    create: 'purchasing.rfqs.create',
    update: 'purchasing.rfqs.update',
    delete: 'purchasing.rfqs.delete',
    award: 'purchasing.rfqs.award',
  },
  orders: {
    view: 'purchasing.orders.view',
    create: 'purchasing.orders.create',
    update: 'purchasing.orders.update',
    delete: 'purchasing.orders.delete',
    approve: 'purchasing.orders.approve',
  },
  receiptsCreate: 'purchasing.receipts.create',
  invoicesCreate: 'purchasing.invoices.create',
  invoicesView: 'purchasing.invoices.view',
  priceOverride: 'purchasing.price_override',
  settingsView: 'settings.view',
} as const

const P = PURCH_PERMS

/** What each screen or action needs (arrays = all of them; alternatives use anyOf). */
export const PURCH_ACCESS = {
  requestList: P.requests.view,
  requestNew: [P.requests.view, P.requests.create],
  /** submit and cancel are edits of the request (RequestPolicy). */
  requestState: P.requests.update,
  /** Conversions need the target's create and the source's view. */
  requestToRfq: [P.rfqs.create, P.requests.view],
  requestToOrder: [P.orders.create, P.requests.view],
  rfqList: P.rfqs.view,
  rfqNew: [P.rfqs.view, P.rfqs.create],
  /** send, quote entry and cancel are edits of the RFQ. */
  rfqState: P.rfqs.update,
  rfqAward: [P.rfqs.award, P.orders.create],
  orderList: P.orders.view,
  orderNew: [P.orders.view, P.orders.create],
  /** submit, revise and close need approve (OrderPolicy); send and cancel are edits. */
  orderSubmit: P.orders.approve,
  orderRevise: P.orders.approve,
  orderClose: P.orders.approve,
  orderSend: P.orders.update,
  orderCancel: P.orders.update,
  createReceipt: [P.receiptsCreate, P.orders.view],
  createInvoice: [P.invoicesCreate, P.orders.view],
  /** GET /suppliers/{id}/exposure: any of orders/invoices view. */
  exposure: anyOf(P.orders.view, P.invoicesView),
} as const

export const PURCH_SECTION = anyOf(P.requests.view, P.rfqs.view, P.orders.view)
