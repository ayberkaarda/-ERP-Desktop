// Shapes of the purchasing request / RFQ / order screens. Wire* types mirror the Purchasing API
// (Http/Resources: RequestResource, RfqResource, DocumentResource, LineResource; DocumentLinks;
// RfqService::comparison; SupplierExposureData; PreviewController). Ids, money (scale 4),
// quantities, prices and rates (scale 6) are decimal strings; dates YYYY-MM-DD.

import type { AuditEntry } from '@/components/shared/AuditTrail'
import type { ApiAuditRow, Envelope, Paginated } from '@/features/sales/shared'

export type { ApiAuditRow, Envelope, Paginated }

/** Lines per document (PurchaseDocument::MAX_LINES). */
export const MAX_LINES = 500

export const REQUEST_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'partially_ordered',
  'ordered',
  'cancelled',
] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export const RFQ_STATUSES = ['draft', 'sent', 'collecting', 'awarded', 'cancelled'] as const
export type RfqStatus = (typeof RFQ_STATUSES)[number]

export const ORDER_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'partially_received',
  'received',
  'partially_invoiced',
  'invoiced',
  'closed',
  'cancelled',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export type PurchaseKind = 'request' | 'rfq' | 'order'

/** document_type of links (DocumentKind plus debit notes). */
export const PURCHASE_DOCUMENT_TYPES = [
  'purchase_request',
  'purchase_rfq',
  'purchase_order',
  'purchase_receipt',
  'purchase_invoice',
  'purchase_debit_note',
  'purchase_return',
] as const
export type PurchaseDocumentType = (typeof PURCHASE_DOCUMENT_TYPES)[number]

/** One entry of the API's `links` (DocumentLinks::link). */
export interface WireLink {
  id: string
  document_type: PurchaseDocumentType | 'unknown'
  number: string | null
  status: string
  document_date: string | null
  total: string | null
  currency_code: string | null
}

/** `links` of a detail: per relation one document, a list, or null (not viewable / none). */
export type WireLinks = Record<string, WireLink | WireLink[] | null>

export interface PurchaseLink {
  type: PurchaseDocumentType
  id: string
  number: string | null
  status: string
  document_date: string
  total: string | null
  currency_code: string | null
}

/** Warning of a preview, save or action (meta.warnings); `line` is the body index. */
export interface WireWarning {
  code: string
  message: string
  line?: number | null
}

export interface PurchaseWarning {
  code: string
  message: string
  line_key?: string | null
  line_no?: number | null
}

/** Labels resolved from Catalog for a line (empty when not readable). */
export interface LineLabels {
  item_code?: string | null
  item_name?: string | null
  unit_code?: string | null
  base_unit_id?: string | null
  base_unit_code?: string | null
}

// ---- requests ----------------------------------------------------------------------------

export interface WireRequestLine {
  id: string
  line_no: number
  item_id: string
  variant_id: string | null
  item_type: 'stock' | 'service' | null
  description: string | null
  quantity: string
  unit_id: string
  base_quantity: string
  estimated_price: string
  estimated_total: string
  suggested_supplier_id: string | null
  needed_by: string | null
  warehouse_id: string | null
  ordered_quantity?: string | null
}

export interface WireRequest {
  id: string
  document_type: 'purchase_request'
  number: string | null
  status: RequestStatus
  document_date: string
  needed_by: string | null
  requested_by: string | null
  warehouse_id: string | null
  cost_center_id: string | null
  project_id: string | null
  currency_code: string
  notes: string | null
  internal_notes: string | null
  estimated_total: string
  approval_request_id: string | null
  approval_comment: string | null
  submitted_at: string | null
  approved_at: string | null
  rejected_at: string | null
  cancelled_at: string | null
  version: number
  created_by: string | null
  created_at: string | null
  updated_at: string | null
  line_count?: number
  lines?: WireRequestLine[]
  links?: WireLinks
  audit?: ApiAuditRow[]
  /** request line id -> quantity on non-cancelled orders (incl. drafts). */
  ordered_quantities?: Record<string, string>
}

export type RequestLine = WireRequestLine & LineLabels & { ordered: string }

export type PurchaseRequest = Omit<
  WireRequest,
  'lines' | 'links' | 'audit' | 'ordered_quantities'
> & {
  lines: RequestLine[]
  links: PurchaseLink[]
  audit: AuditEntry[]
}

export type RequestSummary = Omit<WireRequest, 'lines' | 'links' | 'audit'>

export interface RequestLineInput {
  item_id: string
  variant_id: string | null
  unit_id: string | null
  quantity: string
  estimated_price: string | null
  suggested_supplier_id: string | null
  needed_by: string | null
  warehouse_id: string | null
  description: string | null
}

export interface RequestInput {
  document_date: string
  needed_by: string | null
  warehouse_id: string | null
  notes: string | null
  internal_notes: string | null
  lines?: RequestLineInput[]
}

/** POST /purchase-requests/{id}/rfq */
export interface RequestToRfqInput {
  supplier_ids: string[]
  document_date: string
  response_due: string | null
  currency_code: string | null
  warehouse_id: string | null
  notes: string | null
  lines: { request_line_id: string; quantity: string }[]
}

/** POST /purchase-requests/{id}/orders */
export interface RequestToOrderInput {
  party_id: string
  document_date: string
  expected_date: string | null
  currency_code: string | null
  warehouse_id: string | null
  notes: string | null
  lines: { request_line_id: string; quantity: string; unit_price?: string }[]
}

// ---- RFQs --------------------------------------------------------------------------------

export interface WireRfqLine {
  id: string
  line_no: number
  item_id: string
  variant_id: string | null
  item_type: 'stock' | 'service' | null
  description: string | null
  quantity: string
  unit_id: string
  base_quantity: string
  request_line_id: string | null
  needed_by: string | null
  awarded_party_id: string | null
  awarded_quote_id: string | null
}

export type RfqSupplierStatus = 'invited' | 'responded' | 'declined'

export interface RfqSupplier {
  party_id: string
  party_name: string
  status: RfqSupplierStatus
  responded_at: string | null
}

export interface RfqQuote {
  id: string
  rfq_line_id: string
  party_id: string
  unit_price: string
  discount_percent: string
  net_unit_price: string
  lead_time_days: number | null
  valid_until: string | null
  notes: string | null
}

export interface WireRfq {
  id: string
  document_type: 'purchase_rfq'
  number: string | null
  status: RfqStatus
  document_date: string
  response_due: string | null
  request_id: string | null
  currency_code: string
  warehouse_id: string | null
  notes: string | null
  internal_notes: string | null
  sent_at: string | null
  awarded_at: string | null
  awarded_by: string | null
  cancelled_at: string | null
  version: number
  created_by: string | null
  created_at: string | null
  updated_at: string | null
  line_count?: number
  lines?: WireRfqLine[]
  suppliers?: RfqSupplier[]
  quotes?: RfqQuote[]
  links?: WireLinks
  audit?: ApiAuditRow[]
}

export type RfqLine = WireRfqLine & LineLabels

export type PurchaseRfq = Omit<WireRfq, 'lines' | 'suppliers' | 'quotes' | 'links' | 'audit'> & {
  lines: RfqLine[]
  suppliers: RfqSupplier[]
  quotes: RfqQuote[]
  links: PurchaseLink[]
  audit: AuditEntry[]
}

export type RfqSummary = Omit<WireRfq, 'lines' | 'suppliers' | 'quotes' | 'links' | 'audit'>

export interface RfqLineInput {
  item_id: string
  variant_id: string | null
  unit_id: string | null
  quantity: string
  description: string | null
  needed_by: string | null
}

export interface RfqInput {
  document_date: string
  response_due: string | null
  currency_code: string
  warehouse_id: string | null
  notes: string | null
  internal_notes: string | null
  supplier_ids: string[]
  lines?: RfqLineInput[]
}

export interface QuoteEntryInput {
  party_id: string
  declined?: boolean
  quotes?: {
    rfq_line_id: string
    unit_price: string
    discount_percent: string | null
    lead_time_days: number | null
    valid_until: string | null
    notes: string | null
  }[]
  version?: number
}

/** GET /purchase-rfqs/{id}/comparison */
export interface ComparisonQuote {
  quote_id: string
  party_id: string
  party_name: string | null
  unit_price: string
  discount_percent: string
  net_unit_price: string
  line_total: string
  lead_time_days: number | null
  valid_until: string | null
  notes: string | null
  lowest_price: boolean
  fastest: boolean
}

export interface ComparisonLine {
  rfq_line_id: string
  line_no: number
  item_id: string
  description: string | null
  quantity: string
  unit_id: string
  awarded_party_id: string | null
  /** Sorted by net unit price, lowest first. */
  quotes: ComparisonQuote[]
}

export interface ComparisonSupplier {
  party_id: string
  party_name: string
  status: RfqSupplierStatus
  lines_quoted: number
  total: string | null
  complete: boolean
}

export interface RfqComparison {
  rfq_id: string
  currency_code: string
  lines: ComparisonLine[]
  suppliers: ComparisonSupplier[]
  lowest_total_party_id: string | null
}

/** POST /purchase-rfqs/{id}/award: one supplier for all its quotes, or a supplier per line. */
export interface AwardInput {
  party_id?: string
  lines?: { rfq_line_id: string; party_id: string }[]
  document_date: string
  expected_date: string | null
  warehouse_id: string | null
  version?: number
}

// ---- orders ------------------------------------------------------------------------------

export interface WireOrderLine {
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
  withholding_code_id: string | null
  withholding_rate: string
  withholding_amount: string
  line_total: string
  warehouse_id: string | null
  source_line_id: string | null
  /** manual | source | quote | request */
  price_source: string | null
  received_quantity: string
  invoiced_quantity: string
  request_line_id: string | null
  rfq_line_id: string | null
  expected_date: string | null
}

export interface WireOrder {
  id: string
  document_type: 'purchase_order'
  number: string | null
  status: OrderStatus
  document_date: string
  party_id: string
  party_name: string
  party_tax_office: string | null
  party_tax_number: string | null
  billing_address: Record<string, unknown> | null
  currency_code: string
  fx_rate: string
  payment_term_id: string | null
  due_date: string | null
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
  withholding_total: string
  total: string
  subtotal_local: string
  discount_total_local: string
  tax_total_local: string
  withholding_total_local: string
  total_local: string
  expected_date: string | null
  supplier_reference: string | null
  request_id: string | null
  rfq_id: string | null
  revision: number
  approval_request_id: string | null
  approval_comment: string | null
  approved_at: string | null
  approved_by: string | null
  sent_at: string | null
  cancelled_at: string | null
  closed_at: string | null
  version: number
  created_by: string | null
  created_at: string | null
  updated_at: string | null
  line_count?: number
  lines?: WireOrderLine[]
  links?: WireLinks
  audit?: ApiAuditRow[]
}

export type OrderLine = WireOrderLine & LineLabels

export type PurchaseOrder = Omit<WireOrder, 'lines' | 'links' | 'audit'> & {
  lines: OrderLine[]
  links: PurchaseLink[]
  audit: AuditEntry[]
  /** Tax per code and rate from the lines (the detail carries no tax table). */
  tax_breakdown: TaxRow[]
}

export type OrderSummary = Omit<WireOrder, 'lines' | 'links' | 'audit'>

export interface OrderLineInput {
  id?: string
  item_id: string
  variant_id: string | null
  unit_id: string
  quantity: string
  unit_price: string
  discount_percent: string
  discount_amount: string
  tax_code_id: string | null
  withholding_code_id: string | null
  tax_inclusive: boolean
  description: string | null
  warehouse_id: string | null
  expected_date: string | null
}

export interface OrderInput {
  party_id: string
  document_date: string
  currency_code: string
  fx_rate: string | null
  payment_term_id: string | null
  warehouse_id: string | null
  expected_date: string | null
  supplier_reference: string | null
  notes: string | null
  internal_notes: string | null
  lines?: OrderLineInput[]
}

/** POST /purchase-orders/{id}/receipts */
export interface ReceiptFromOrderInput {
  document_date: string
  warehouse_id: string | null
  supplier_reference: string | null
  notes: string | null
  lines: { order_line_id: string; quantity: string }[]
}

/** POST /purchase-orders/{id}/invoices */
export interface InvoiceFromOrderInput {
  document_date: string
  due_date: string | null
  supplier_invoice_no: string | null
  receive_on_invoice: boolean
  notes: string | null
  lines: { order_line_id: string; quantity: string }[]
}

/** Created receipt / invoice (DocumentResource, only what the wizard needs). */
export interface CreatedDocument {
  id: string
  number: string | null
  status: string
  document_type: string
}

// ---- preview, supplier -------------------------------------------------------------------

export interface PreviewLineInput {
  key: string
  item_id: string
  variant_id: string | null
  unit_id: string
  quantity: string
  unit_price: string
  discount_percent: string
  discount_amount: string
  tax_code_id: string | null
  withholding_code_id: string | null
  tax_inclusive: boolean
  warehouse_id: string | null
}

export interface PreviewInput {
  party_id: string
  document_date: string
  currency_code: string
  fx_rate: string | null
  warehouse_id: string | null
  lines: PreviewLineInput[]
}

export interface WirePreview {
  header: { currency_code: string; fx_rate: string } & Record<string, unknown>
  lines: {
    unit_price: string
    price_source: string | null
    base_quantity: string
    net_amount: string
    tax_code_id: string | null
    tax_rate: string
    tax_amount: string
    withholding_amount: string
    line_total: string
  }[]
  taxes: { tax_code_id: string | null; rate: string; base: string; tax: string }[]
  totals: {
    subtotal: string
    discount_total: string
    tax_total: string
    withholding_total: string
    total: string
    total_local: string
  }
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
  withholding_amount: string
  line_total: string
}

export interface TaxRow {
  tax_code_id: string | null
  tax_code?: string | null
  rate: string
  base: string
  amount: string
}

export interface PreviewTotals {
  lines: PreviewLine[]
  subtotal: string
  discount_total: string
  tax_total: string
  withholding_total: string
  total: string
  total_local: string
  fx_rate: string
  tax_breakdown: TaxRow[]
  warnings: PurchaseWarning[]
}

/** GET /suppliers/{id}/exposure (company currency, scale 2; informational only). */
export interface SupplierExposure {
  party_id: string
  currency: string
  open_payables: string
  open_orders: string
  total: string
  overdue_payables: string
}
