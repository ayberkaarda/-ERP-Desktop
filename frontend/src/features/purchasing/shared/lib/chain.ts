import type { PurchaseDocumentType, PurchaseLink } from '../types'

/** App routes of the purchasing areas (receipts, invoices, returns belong to fe-purch2). */
export const PURCH_PATHS = {
  request: '/purchasing/requests',
  rfq: '/purchasing/rfqs',
  order: '/purchasing/orders',
  receipt: '/purchasing/receipts',
  invoice: '/purchasing/invoices',
  return: '/purchasing/returns',
} as const

/** Order of the stages in the chain. */
export const CHAIN_STAGES: readonly PurchaseDocumentType[] = [
  'purchase_request',
  'purchase_rfq',
  'purchase_order',
  'purchase_receipt',
  'purchase_invoice',
  'purchase_return',
  'purchase_debit_note',
]

export function documentPath(type: PurchaseDocumentType, id: string): string {
  const seg = encodeURIComponent(id)
  switch (type) {
    case 'purchase_request':
      return `${PURCH_PATHS.request}/${seg}`
    case 'purchase_rfq':
      return `${PURCH_PATHS.rfq}/${seg}`
    case 'purchase_order':
      return `${PURCH_PATHS.order}/${seg}`
    case 'purchase_receipt':
      return `${PURCH_PATHS.receipt}/${seg}`
    case 'purchase_invoice':
    case 'purchase_debit_note':
      return `${PURCH_PATHS.invoice}/${seg}`
    case 'purchase_return':
      return `${PURCH_PATHS.return}/${seg}`
  }
}

export interface ChainNode extends PurchaseLink {
  current: boolean
}

/** The document and its links by stage, then date and number; duplicates dropped. */
export function buildChain(current: PurchaseLink, links: readonly PurchaseLink[]): ChainNode[] {
  const seen = new Set<string>()
  const nodes: ChainNode[] = []
  for (const n of [
    { ...current, current: true },
    ...links.map((l) => ({ ...l, current: false })),
  ]) {
    const k = `${n.type}:${n.id}`
    if (seen.has(k)) continue
    seen.add(k)
    nodes.push(n)
  }
  const stage = (t: PurchaseDocumentType) => CHAIN_STAGES.indexOf(t)
  return nodes.sort(
    (a, b) =>
      stage(a.type) - stage(b.type) ||
      a.document_date.localeCompare(b.document_date) ||
      (a.number ?? '').localeCompare(b.number ?? ''),
  )
}
