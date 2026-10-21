import { anyOf } from '@/lib/permissions'

/**
 * Permission names of the delivery, invoice, return and report endpoints. The resource verbs follow
 * PHASE5 (sales.<resource>.view|create|update|delete|approve|issue|reverse); delivery post and
 * return receive/credit are assumed names (see .orchestra/fe-sales2.md).
 */
export const SALES_PERMS = {
  deliveries: {
    view: 'sales.deliveries.view',
    create: 'sales.deliveries.create',
    update: 'sales.deliveries.update',
    delete: 'sales.deliveries.delete',
    post: 'sales.deliveries.post',
    /** Cancelling a posted delivery reverses its stock movements. */
    reverse: 'sales.deliveries.reverse',
  },
  invoices: {
    view: 'sales.invoices.view',
    create: 'sales.invoices.create',
    update: 'sales.invoices.update',
    delete: 'sales.invoices.delete',
    approve: 'sales.invoices.approve',
    issue: 'sales.invoices.issue',
    reverse: 'sales.invoices.reverse',
  },
  returns: {
    view: 'sales.returns.view',
    create: 'sales.returns.create',
    update: 'sales.returns.update',
    delete: 'sales.returns.delete',
    approve: 'sales.returns.approve',
    receive: 'sales.returns.receive',
    credit: 'sales.returns.credit',
  },
  orders: { view: 'sales.orders.view' },
  reports: 'sales.reports.view',
  creditOverride: 'sales.credit_override',
  priceOverride: 'sales.price_override',
  journalView: 'accounting.journal.view',
} as const

const P = SALES_PERMS

/** What opening a page needs (route guards and palette entries). */
export const SALES_OPEN = {
  deliveries: P.deliveries.view,
  newDelivery: [P.deliveries.view, P.deliveries.create],
  invoices: P.invoices.view,
  newInvoice: [P.invoices.view, P.invoices.create],
  returns: P.returns.view,
  newReturn: [P.returns.view, P.returns.create],
  reports: P.reports,
  /** The Parties sales tab shows whatever of summary / exposure the user may read. */
  customerSummary: anyOf(P.invoices.view, P.orders.view, P.reports),
} as const

/** Saving a stored draft (PATCH, update) or a new one (POST, create). */
export const saveDraftPermission = (
  resource: 'deliveries' | 'invoices' | 'returns',
  stored: boolean,
): string => (stored ? P[resource].update : P[resource].create)
