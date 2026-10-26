import { anyOf } from '@/lib/permissions'

/**
 * Permission names of the receipt, invoice, return and report endpoints (Purchasing
 * permissions.php). Cancelling a draft is an update; cancelling a posted receipt needs reverse.
 */
export const PURCH_PERMS = {
  receipts: {
    view: 'purchasing.receipts.view',
    create: 'purchasing.receipts.create',
    update: 'purchasing.receipts.update',
    delete: 'purchasing.receipts.delete',
    post: 'purchasing.receipts.post',
    reverse: 'purchasing.receipts.reverse',
  },
  invoices: {
    view: 'purchasing.invoices.view',
    create: 'purchasing.invoices.create',
    update: 'purchasing.invoices.update',
    delete: 'purchasing.invoices.delete',
    book: 'purchasing.invoices.book',
    reverse: 'purchasing.invoices.reverse',
  },
  returns: {
    view: 'purchasing.returns.view',
    create: 'purchasing.returns.create',
    update: 'purchasing.returns.update',
    delete: 'purchasing.returns.delete',
    approve: 'purchasing.returns.approve',
    ship: 'purchasing.returns.ship',
    debit: 'purchasing.returns.debit',
  },
  orders: { view: 'purchasing.orders.view' },
  reports: 'purchasing.reports.view',
  matchOverride: 'purchasing.match_override',
  priceOverride: 'purchasing.price_override',
  journalView: 'accounting.entries.view',
  stockDocumentView: 'inventory.documents.view',
} as const

const P = PURCH_PERMS

/** What opening a page needs (route guards and palette entries). */
export const PURCH_OPEN = {
  receipts: P.receipts.view,
  newReceipt: [P.receipts.view, P.receipts.create],
  invoices: P.invoices.view,
  newInvoice: [P.invoices.view, P.invoices.create],
  returns: P.returns.view,
  newReturn: [P.returns.view, P.returns.create],
  reports: P.reports,
  /** GET /suppliers/{id}/exposure|purchase-summary|performance (purchasing-supplier-view). */
  supplierSummary: anyOf(P.orders.view, P.invoices.view),
} as const

/** Saving a stored draft (PATCH, update) or a new one (POST, create). */
export const saveDraftPermission = (
  resource: 'receipts' | 'invoices' | 'returns',
  stored: boolean,
): string => (stored ? P[resource].update : P[resource].create)
