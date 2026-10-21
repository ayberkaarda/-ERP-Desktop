import Decimal from 'decimal.js'
import { dec, isDecimal } from './lines'
import type { CustomerExposure, SalesDocumentLink, SalesDocumentType } from '../types'
import type { ItemStockSummary } from '../api'

export type HintTone = 'ok' | 'low' | 'short'

export interface StockHint {
  available: string
  tone: HintTone
}

/**
 * Availability of an item for a line: in the document warehouse when one is chosen (else over
 * all warehouses), against everything the document asks of that item in base units.
 * `low` = enough, but less than twice the need.
 */
export function stockHint(
  stock: ItemStockSummary | undefined,
  warehouseId: string,
  needed: Decimal,
): StockHint | null {
  if (!stock) return null
  const figures = warehouseId
    ? (stock.warehouses.find((w) => w.warehouse_id === warehouseId) ?? {
        available: '0',
      })
    : stock
  const available = dec(figures.available)
  let tone: HintTone = 'ok'
  if (available.lt(needed)) tone = 'short'
  else if (available.lt(needed.mul(2))) tone = 'low'
  return { available: available.toString(), tone }
}

export type ExposureTone = 'unlimited' | 'ok' | 'tight' | 'over'

export interface ExposureState {
  tone: ExposureTone
  /** Available after this document (null when unlimited). */
  after: string | null
}

/**
 * Exposure badge state: over when this document's total (company currency, only when the risk
 * currency is the same) exceeds what is available; tight when under 20% of the limit remains.
 */
export function exposureState(
  exposure: CustomerExposure,
  documentTotal: string | null,
  documentCurrency: string,
): ExposureState {
  if (exposure.limit === null || !isDecimal(exposure.limit))
    return { tone: 'unlimited', after: null }
  const available = isDecimal(exposure.available)
    ? new Decimal(exposure.available)
    : new Decimal(exposure.limit).minus(dec(exposure.total))
  const comparable = documentTotal !== null && documentCurrency === exposure.currency
  const after = comparable ? available.minus(dec(documentTotal)) : available
  if (after.isNegative()) return { tone: 'over', after: after.toString() }
  const limit = new Decimal(exposure.limit)
  if (limit.gt(0) && after.lt(limit.mul('0.2'))) return { tone: 'tight', after: after.toString() }
  return { tone: 'ok', after: after.toString() }
}

/** Order of the stages in the chain. */
export const CHAIN_STAGES: SalesDocumentType[] = [
  'sales_quote',
  'sales_order',
  'sales_delivery',
  'sales_invoice',
  'sales_return',
]

export interface ChainNode extends SalesDocumentLink {
  current: boolean
}

/**
 * The chain around a document: its links plus itself, by stage then date; duplicates (the
 * same document listed twice) are dropped.
 */
export function buildChain(
  current: Omit<SalesDocumentLink, 'direction'>,
  links: readonly SalesDocumentLink[] = [],
): ChainNode[] {
  const seen = new Set<string>()
  const nodes: ChainNode[] = []
  const push = (n: ChainNode) => {
    const k = `${n.type}:${n.id}`
    if (seen.has(k)) return
    seen.add(k)
    nodes.push(n)
  }
  push({ ...current, direction: 'upstream', current: true })
  for (const l of links) push({ ...l, current: false })
  const stage = (t: SalesDocumentType) => CHAIN_STAGES.indexOf(t)
  return nodes.sort(
    (a, b) =>
      stage(a.type) - stage(b.type) ||
      a.document_date.localeCompare(b.document_date) ||
      (a.number ?? '').localeCompare(b.number ?? ''),
  )
}

/** App route of a chain document (deliveries, invoices and returns belong to fe-sales2). */
export function documentPath(type: SalesDocumentType, id: string): string {
  const seg = encodeURIComponent(id)
  switch (type) {
    case 'sales_quote':
      return `/sales/quotes/${seg}`
    case 'sales_order':
      return `/sales/orders/${seg}`
    case 'sales_delivery':
      return `/sales/deliveries/${seg}`
    case 'sales_invoice':
      return `/sales/invoices/${seg}`
    case 'sales_return':
      return `/sales/returns/${seg}`
  }
}

export const SALES_PATHS = { quote: '/sales/quotes', order: '/sales/orders' } as const
