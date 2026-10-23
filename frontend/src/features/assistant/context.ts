import type { RecordContext } from './types'
export const CONTEXT_LABELS = {
  party: 'contextParty',
  item: 'contextItem',
  sales_quote: 'contextQuote',
  sales_order: 'contextSalesOrder',
  sales_invoice: 'contextSalesInvoice',
  purchase_request: 'contextPurchaseRequest',
  purchase_order: 'contextPurchaseOrder',
  purchase_invoice: 'contextPurchaseInvoice',
  treasury_account: 'contextTreasuryAccount',
  journal_entry: 'contextJournal',
} as const

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const records: [string, RegExp][] = [
  ['party', new RegExp(`^/parties/(${UUID})$`, 'i')],
  ['item', new RegExp(`^/catalog/items/(${UUID})$`, 'i')],
  ['sales_quote', new RegExp(`^/sales/quotes/(${UUID})$`, 'i')],
  ['sales_order', new RegExp(`^/sales/orders/(${UUID})$`, 'i')],
  ['sales_invoice', new RegExp(`^/sales/invoices/(${UUID})$`, 'i')],
  ['purchase_request', new RegExp(`^/purchasing/requests/(${UUID})$`, 'i')],
  ['purchase_order', new RegExp(`^/purchasing/orders/(${UUID})$`, 'i')],
  ['purchase_invoice', new RegExp(`^/purchasing/invoices/(${UUID})$`, 'i')],
  ['treasury_account', new RegExp(`^/treasury/accounts/(${UUID})$`, 'i')],
  ['journal_entry', new RegExp(`^/accounting/journal/(${UUID})$`, 'i')],
]
export function contextFromPath(path: string): RecordContext | null {
  for (const [type, pattern] of records) {
    const match = pattern.exec(path)
    if (match?.[1]) return { type, id: match[1] }
  }
  return null
}
