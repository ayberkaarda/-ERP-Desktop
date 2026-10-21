// Shapes shared by the delivery, invoice and return endpoints of the Sales module (/api/v1).
// Envelopes follow Core ApiResponse: `{data, meta?}`, lists `{data, meta: {pagination}}`.
// Ids are UUID strings; money (numeric(20,4)), quantities (numeric(20,6)) and rates are decimal
// strings end to end; calendar dates are "YYYY-MM-DD", timestamps ISO 8601.

export interface Pagination {
  total: number
  current_page: number
  last_page: number
  per_page: number
}

export interface Paginated<T> {
  data: T[]
  meta: { pagination: Pagination }
}

export interface Envelope<T, M = Record<string, unknown>> {
  data: T
  meta?: M
}

export interface Address {
  line1?: string | null
  line2?: string | null
  district?: string | null
  city?: string | null
  postal_code?: string | null
  country?: string | null
}

/** Customer fields frozen on the document when it is created. */
export interface PartySnapshot {
  name: string
  tax_office: string | null
  tax_number: string | null
  billing_address: Address | null
}

/** Non-blocking server notes (credit warn mode, price overrides, stock shortage). */
export interface DocWarning {
  code: string
  message: string
}

export const LINK_TYPES = [
  'sales_quote',
  'sales_order',
  'sales_delivery',
  'sales_invoice',
  'sales_return',
  'stock_document',
  'journal_entry',
] as const
export type LinkType = (typeof LINK_TYPES)[number]

/** A document before (source) or after (target) this one in the sales chain. */
export interface DocLink {
  type: LinkType
  id: string
  number: string | null
  status?: string | null
  document_date?: string | null
  relation: 'source' | 'target'
}

export interface ApiAuditRow {
  event: string | null
  description: string | null
  causer_id: string | null
  causer_name?: string | null
  created_at: string | null
}

/** Header fields every sales document carries. */
export interface SalesHeader {
  id: string
  /** Gapless per type and fiscal year, assigned at post / issue; null on drafts. */
  number: string | null
  status: string
  document_date: string
  party_id: string
  /** List rows carry the snapshot name for display. */
  party_name?: string | null
  party_snapshot?: PartySnapshot | null
  currency_code: string
  fx_rate: string
  warehouse_id: string | null
  notes: string | null
  internal_notes?: string | null
  source_type: string | null
  source_id: string | null
  version: number
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
}

/** Money totals of invoices (and of returns once credited); *_local in company currency. */
export interface SalesTotals {
  subtotal: string
  discount_total: string
  tax_total: string
  total: string
  subtotal_local?: string
  discount_total_local?: string
  tax_total_local?: string
  total_local?: string
}

export interface PrintParty {
  name: string
  tax_office: string | null
  tax_number: string | null
  address: string | null
  phone?: string | null
  email?: string | null
}

export interface PrintLine {
  line_no: number
  item_code: string | null
  description: string
  quantity: string
  unit_code: string | null
  unit_price?: string | null
  discount_percent?: string | null
  net_amount?: string | null
  tax_rate?: string | null
  tax_amount?: string | null
  line_total?: string | null
  lot_no?: string | null
  serial_numbers?: string[]
}

/**
 * GET /sales-<resource>/{id}/print-model: structured JSON the browser prints with CSS
 * (no PDF engine yet). Money fields are absent on dispatch notes.
 */
export interface PrintModel {
  document_type: 'sales_delivery' | 'sales_invoice' | 'sales_return'
  /** Server-chosen title ("Satış Faturası", "İade Faturası", "Sevk İrsaliyesi"). */
  title: string
  number: string | null
  status: string
  document_date: string
  due_date?: string | null
  issued_at?: string | null
  currency_code?: string | null
  fx_rate?: string | null
  company: PrintParty
  party: PrintParty
  delivery_address?: string | null
  references?: { label: string; value: string }[]
  lines: PrintLine[]
  tax_summary?: { tax_code: string; rate: string; base: string; amount: string }[]
  totals?: SalesTotals | null
  amount_in_words?: string | null
  notes?: string | null
  footer?: string | null
}

/** GET /customers/{id}/exposure (company currency unless risk currency differs). */
export interface CustomerExposure {
  limit: string | null
  currency: string
  open_invoices: string
  open_orders: string
  total: string
  /** null when the party has no risk limit (unlimited). */
  available: string | null
  /** With ?document_id: that document's amount converted to the risk currency. */
  document_amount?: string | null
}

/** API limit per document. */
export const MAX_LINES = 500
