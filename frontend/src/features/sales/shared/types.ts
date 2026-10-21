// API shapes of the sales quote/order endpoints as assumed from PHASE5.md (HTTP API); every
// assumption is listed in .orchestra/fe-sales1.md for the integration lane. Ids, money (scale 4),
// quantities and rates (scale 6) are decimal strings; dates are calendar dates (YYYY-MM-DD).

export interface Pagination {
  current_page: number
  per_page: number
  total: number
  last_page: number
}

export interface Envelope<T, M = Record<string, unknown>> {
  data: T
  meta?: M
}

export interface Paginated<T> {
  data: T[]
  meta: { pagination: Pagination }
}

export const QUOTE_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'converted',
  'cancelled',
] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

export const ORDER_STATUSES = [
  'draft',
  'pending_approval',
  'confirmed',
  'partially_delivered',
  'delivered',
  'partially_invoiced',
  'invoiced',
  'closed',
  'cancelled',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export type SalesKind = 'quote' | 'order'

/** Morph aliases of the sales documents (links, attachments, audit). */
export type SalesDocumentType =
  'sales_quote' | 'sales_order' | 'sales_delivery' | 'sales_invoice' | 'sales_return'

/** Warning attached to a preview, a saved document or an action response (meta.warnings). */
export interface SalesWarning {
  code: string
  message: string
  /** Client key of the line (preview) or its line number (stored documents). */
  line_key?: string | null
  line_no?: number | null
  severity?: 'info' | 'warning' | 'danger'
}

/** One document linked to this one in the quote -> order -> delivery -> invoice -> return chain. */
export interface SalesDocumentLink {
  type: SalesDocumentType
  id: string
  number: string | null
  status: string
  document_date: string
  total?: string | null
  currency_code?: string | null
  /** upstream = a source of this document; downstream = created from it. */
  direction: 'upstream' | 'downstream'
}

export interface PartySnapshot {
  name: string
  tax_office: string | null
  tax_number: string | null
  billing_address?: Record<string, unknown> | null
}

export interface ApiAuditRow {
  event: string | null
  description?: string | null
  causer_id?: string | null
  causer_name?: string | null
  created_at?: string | null
  properties?: {
    attributes?: Record<string, unknown>
    old?: Record<string, unknown>
  } | null
}

export interface SalesLine {
  id: string
  line_no: number
  item_id: string
  item_code?: string | null
  item_name?: string | null
  /** Catalog item type; service lines may be invoiced without delivery. */
  item_type?: 'stock' | 'service' | null
  variant_id: string | null
  description: string | null
  quantity: string
  unit_id: string
  unit_code?: string | null
  base_quantity: string
  base_unit_id?: string | null
  base_unit_code?: string | null
  unit_price: string
  /** Whether the price was typed (override) or resolved by the server. */
  price_source: string | null
  discount_percent: string
  discount_amount: string
  net_amount: string
  tax_code_id: string | null
  tax_code?: string | null
  tax_rate: string
  tax_amount: string
  line_total: string
  warehouse_id: string | null
  source_line_id: string | null
}

export interface SalesOrderLine extends SalesLine {
  delivered_quantity: string
  invoiced_quantity: string
  reservation_id: string | null
}

export interface TaxBreakdownRow {
  tax_code_id: string | null
  tax_code?: string | null
  rate: string
  base: string
  amount: string
}

interface SalesDocumentBase {
  id: string
  number: string | null
  document_date: string
  party_id: string
  party: PartySnapshot
  currency_code: string
  /** Company currency (the *_local totals are in it). */
  local_currency_code?: string | null
  fx_rate: string
  payment_term_id: string | null
  due_date: string | null
  price_list_id: string | null
  warehouse_id: string | null
  cost_center_id: string | null
  project_id: string | null
  notes: string | null
  internal_notes: string | null
  source_type: SalesDocumentType | null
  source_id: string | null
  subtotal: string
  discount_total: string
  tax_total: string
  total: string
  total_local: string
  tax_breakdown?: TaxBreakdownRow[]
  warnings?: SalesWarning[]
  links?: SalesDocumentLink[]
  version: number
  created_by: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface ApiSalesQuote extends SalesDocumentBase {
  status: QuoteStatus
  valid_until: string | null
  revision: number
  previous_revision_id: string | null
  lines: SalesLine[]
  audit?: ApiAuditRow[]
}

export interface ApiSalesOrder extends SalesDocumentBase {
  status: OrderStatus
  requested_delivery_date: string | null
  /** Workflow ApprovalRequest while (or after) the order waited for approval. */
  approval_request_id: string | null
  /** Rejection comment when an approval sent the order back to draft. */
  approval_comment?: string | null
  /** sales.allow_over_delivery_percent at read time (0 when absent). */
  over_delivery_percent?: string | null
  credit_override_reason?: string | null
  lines: SalesOrderLine[]
  audit?: ApiAuditRow[]
}

export interface SalesQuoteSummary {
  id: string
  number: string | null
  status: QuoteStatus
  document_date: string
  valid_until: string | null
  party_id: string
  party_name: string
  currency_code: string
  total: string
  total_local: string
  revision: number
  version: number
}

export interface SalesOrderSummary {
  id: string
  number: string | null
  status: OrderStatus
  document_date: string
  requested_delivery_date: string | null
  party_id: string
  party_name: string
  currency_code: string
  total: string
  total_local: string
  version: number
}

/** Line of a create/PATCH/revise body; unit_price null lets the server resolve the price. */
export interface SalesLineInput {
  id?: string
  item_id: string
  variant_id: string | null
  description: string | null
  quantity: string
  unit_id: string
  unit_price: string | null
  discount_percent: string
  discount_amount: string
  tax_code_id: string | null
  warehouse_id: string | null
}

export interface SalesDocumentInput {
  party_id: string
  document_date: string
  currency_code: string
  fx_rate: string | null
  payment_term_id: string | null
  price_list_id: string | null
  warehouse_id: string | null
  notes: string | null
  internal_notes: string | null
  /** Quotes only. */
  valid_until?: string | null
  /** Orders only. */
  requested_delivery_date?: string | null
  lines: SalesLineInput[]
}

/** POST /sales-documents/preview-totals body: nothing is stored. */
export interface PreviewTotalsInput {
  document_type: SalesKind
  party_id: string | null
  document_date: string
  currency_code: string
  fx_rate: string | null
  price_list_id: string | null
  warehouse_id: string | null
  lines: (Omit<SalesLineInput, 'id' | 'description'> & { key: string })[]
}

export interface PreviewLine {
  key: string
  unit_price: string
  price_source: string | null
  base_quantity: string
  net_amount: string
  tax_code_id: string | null
  tax_rate: string
  tax_amount: string
  line_total: string
}

export interface PreviewTotals {
  lines: PreviewLine[]
  subtotal: string
  discount_total: string
  tax_total: string
  total: string
  total_local: string
  fx_rate: string
  local_currency_code?: string | null
  tax_breakdown: TaxBreakdownRow[]
  warnings: SalesWarning[]
}

/** GET /customers/{id}/exposure (CustomerExposure contract, company currency converted to risk). */
export interface CustomerExposure {
  party_id: string
  /** null = no risk limit (unlimited). */
  limit: string | null
  currency: string
  open_invoices: string
  open_orders: string
  total: string
  available: string | null
}

/** Breakdown the confirm/revise endpoints return with 422 sales.credit_limit_exceeded. */
export interface CreditBreakdown {
  limit: string | null
  exposure: string | null
  document: string | null
  currency: string | null
}

/** POST /sales-orders/{id}/deliveries and /invoices: partial quantities per order line. */
export interface FulfilmentInput {
  document_date: string
  warehouse_id?: string | null
  /** Invoice of stock lines not delivered yet: the server posts the delivery itself. */
  deliver_on_invoice?: boolean
  lines: { order_line_id: string; quantity: string }[]
}

/** The draft delivery or invoice the conversion created (fe-sales2 opens it). */
export interface CreatedDocument {
  id: string
  number: string | null
  status: string
}

export const MAX_LINES = 500
