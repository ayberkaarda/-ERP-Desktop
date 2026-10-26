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

/** Party billing address snapshot (Parties PartyAddressLookup). */
export interface Address {
  label?: string | null
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
  details?: Record<string, unknown> | null
  line?: number | null
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
  total?: string | null
  currency_code?: string | null
  /** A return invoice (credit note); `type` stays sales_invoice for its route. */
  credit?: boolean
  relation: 'source' | 'target'
}

export interface ApiAuditRow {
  event: string | null
  description: string | null
  causer_id: string | null
  causer_name?: string | null
  properties?: Record<string, unknown> | null
  created_at: string | null
}

// ---- Wire shapes (Sales DocumentResource, LineResource, DocumentLinks) ----

export type ApiDocumentType =
  'sales_quote' | 'sales_order' | 'sales_delivery' | 'sales_invoice' | 'sales_return'

/** One chain entry as DocumentLinks::link sends it. */
export interface ApiLink {
  id: string
  document_type: ApiDocumentType | 'sales_credit_note'
  number: string | null
  status: string
  document_date: string
  total: string
  currency_code: string
}

/** `links` of a detail: named relations (one document or a list) per document type. */
export type ApiLinks = Record<string, ApiLink | ApiLink[] | null>

/** Header columns every document carries (flat party snapshot, totals in both currencies). */
export interface ApiHeader {
  id: string
  document_type: ApiDocumentType
  /** Gapless per type and year, assigned at post / issue / approve; null on drafts. */
  number: string | null
  status: string
  document_date: string
  party_id: string
  party_name: string | null
  party_tax_office: string | null
  party_tax_number: string | null
  billing_address: Address | null
  currency_code: string
  fx_rate: string
  payment_term_id: string | null
  due_date: string | null
  price_list_id: string | null
  warehouse_id: string | null
  cost_center_id: string | null
  project_id: string | null
  notes: string | null
  internal_notes: string | null
  source_type: string | null
  source_id: string | null
  subtotal: string
  discount_total: string
  tax_total: string
  total: string
  subtotal_local: string
  discount_total_local: string
  tax_total_local: string
  total_local: string
  version: number
  created_by: string | null
  created_at: string | null
  updated_at: string | null
  /** Lists only. */
  line_count?: number
}

/** Line columns every document line carries (ids only, no labels). */
export interface ApiLine {
  id: string
  line_no: number
  item_id: string
  variant_id: string | null
  item_type: 'stock' | 'service' | null
  description: string | null
  quantity: string
  unit_id: string
  base_quantity: string
  unit_price: string
  tax_inclusive: boolean
  discount_percent: string
  discount_amount: string
  gross_amount: string
  line_discount: string
  net_amount: string
  tax_code_id: string | null
  tax_rate: string
  tax_amount: string
  line_total: string
  warehouse_id: string | null
  source_line_id: string | null
  price_source: string | null
}

/** What GET /{resource}/{id} adds to the document. */
export interface ApiDetailExtras {
  links?: ApiLinks
  warnings?: DocWarning[]
  audit?: ApiAuditRow[]
}

/** Labels the UI adds to a line from Catalog (the API sends ids only). */
export interface LineLabels {
  item_code?: string | null
  item_name?: string | null
  unit_code?: string | null
}

/** Header of a document as the screens use it: the wire header plus the party snapshot. */
export interface SalesHeader extends ApiHeader {
  party_snapshot?: PartySnapshot | null
}

/** Money totals; *_local in company currency. */
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

export interface PrintLine {
  line_no: number
  item_code: string | null
  item_name: string | null
  description: string | null
  quantity: string
  unit_code: string | null
  unit_name: string | null
  unit_price: string
  discount_percent: string
  discount_amount: string
  net_amount: string
  tax_rate: string
  tax_amount: string
  line_total: string
  lot_no: string | null
  serial_numbers: string[] | null
}

/**
 * GET /sales-<resource>/{id}/print-model: structured JSON the browser prints with CSS
 * (no PDF engine yet). `document` is the header as the detail sends it.
 */
export interface PrintModel {
  document_type: ApiDocumentType | 'sales_credit_note'
  company: { id: string; name: string | null; [key: string]: unknown }
  document: ApiHeader & Record<string, unknown>
  party: {
    id: string
    name: string | null
    tax_office: string | null
    tax_number: string | null
    billing_address: Address | null
  }
  lines: PrintLine[]
  taxes: { rate: string; base: string; tax: string }[]
  totals: SalesTotals
}

/** GET /customers/{id}/exposure, in the party's risk currency (scale 2). */
export interface CustomerExposure {
  party_id?: string
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
