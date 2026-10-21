import type { LinkType } from './types'

/** App routes of the documents a sales document links to. */
export const LINK_PATHS: Record<LinkType, string> = {
  sales_quote: '/sales/quotes',
  sales_order: '/sales/orders',
  sales_delivery: '/sales/deliveries',
  sales_invoice: '/sales/invoices',
  sales_return: '/sales/returns',
  stock_document: '/inventory/documents',
  journal_entry: '/accounting/journal-entries',
}

export const linkTo = (type: LinkType, id: string) =>
  `${LINK_PATHS[type]}/${encodeURIComponent(id)}`

export const DELIVERIES_BASE = LINK_PATHS.sales_delivery
export const INVOICES_BASE = LINK_PATHS.sales_invoice
export const RETURNS_BASE = LINK_PATHS.sales_return
export const REPORTS_BASE = '/sales/reports'
