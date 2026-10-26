import type { LinkType } from './types'

/** App routes of related purchasing documents. */
export const LINK_PATHS: Record<LinkType, string> = {
  purchase_request: '/purchasing/requests',
  purchase_rfq: '/purchasing/rfqs',
  purchase_order: '/purchasing/orders',
  purchase_receipt: '/purchasing/receipts',
  purchase_invoice: '/purchasing/invoices',
  purchase_debit_note: '/purchasing/invoices',
  purchase_return: '/purchasing/returns',
  stock_document: '/inventory/documents',
  journal_entry: '/accounting/journal-entries',
}

export const linkTo = (type: LinkType, id: string) =>
  `${LINK_PATHS[type]}/${encodeURIComponent(id)}`

export const RECEIPTS_BASE = LINK_PATHS.purchase_receipt
export const INVOICES_BASE = LINK_PATHS.purchase_invoice
export const RETURNS_BASE = LINK_PATHS.purchase_return
export const ORDERS_BASE = LINK_PATHS.purchase_order
export const REPORTS_BASE = '/purchasing/reports'
