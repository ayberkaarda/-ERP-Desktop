// Wire shapes of the Purchasing receipt, invoice and return endpoints (/api/v1) as
// DocumentResource, LineResource, DocumentLinks and PrintModel send them. Ids are UUID strings;
// money (numeric(20,4)), quantities (numeric(20,6)) and rates are decimal strings end to end.
import type {
  Address,
  ApiAuditRow,
  DocWarning,
  Envelope,
  Paginated,
  PartySnapshot,
} from '@/features/sales/invoices/kit/types'

export type { Address, ApiAuditRow, DocWarning, Envelope, Paginated, PartySnapshot }

export type PurchaseDocumentType =
  | 'purchase_request'
  | 'purchase_rfq'
  | 'purchase_order'
  | 'purchase_receipt'
  | 'purchase_invoice'
  | 'purchase_debit_note'
  | 'purchase_return'

/** Link targets in the app: purchasing documents plus the postings they created. */
export type LinkType = PurchaseDocumentType | 'stock_document' | 'journal_entry'

/** One chain entry as DocumentLinks::link sends it. */
export interface ApiLink {
  id: string
  document_type: PurchaseDocumentType | 'unknown'
  number: string | null
  status: string | null
  document_date: string | null
  total: string | null
  currency_code: string | null
}

/** `links` of a detail: named relations (one document or a list) per document type. */
export type ApiLinks = Record<string, ApiLink | ApiLink[] | null>

/** A document before (source) or after (target) this one in the purchase chain. */
export interface DocLink {
  type: LinkType
  id: string
  number: string | null
  status?: string | null
  document_date?: string | null
  total?: string | null
  currency_code?: string | null
  relation: 'source' | 'target'
}

/** Header columns every purchasing document carries (flat supplier snapshot, both currencies). */
export interface ApiHeader {
  id: string
  document_type: PurchaseDocumentType
  /** Gapless per type and year: GRN at post, PIN/PDN at book, PRT at approve; null on drafts. */
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
  withholding_total: string
  subtotal_local: string
  discount_total_local: string
  tax_total_local: string
  total_local: string
  withholding_total_local: string
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
  withholding_code_id: string | null
  /** Withheld share of the VAT in percent (5/10 = "50.0000"). */
  withholding_rate: string
  withholding_amount: string
  line_total: string
  warehouse_id: string | null
  source_line_id: string | null
  /** manual | source | quote | request */
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
  item_code: string | null
  item_name: string | null
  unit_code: string | null
  item_tracking: 'none' | 'lot' | 'serial'
  item_has_expiry: boolean
}

/** Money totals; *_local in company currency. */
export interface PurchaseTotals {
  subtotal: string
  discount_total: string
  tax_total: string
  total: string
  withholding_total: string
  subtotal_local?: string
  discount_total_local?: string
  tax_total_local?: string
  total_local?: string
  withholding_total_local?: string
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
  withholding_rate: string
  withholding_amount: string
  line_total: string
  lot_no: string | null
  serial_numbers: string[] | null
}

/**
 * GET /purchase-<resource>/{id}/print-model: structured JSON the browser prints with CSS.
 * `document` is the header as the detail sends it.
 */
export interface PrintModel {
  document_type: PurchaseDocumentType
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
  taxes: { rate: string; base: string; tax: string; withholding: string }[]
  totals: PurchaseTotals
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

/** GET /suppliers/{id}/performance?from=&to= (rates are fractions 0..1, null without data). */
export interface SupplierPerformance {
  party_id: string
  from: string
  to: string
  orders: number
  on_time_rate: string | null
  fill_rate: string | null
  avg_lead_days: string | null
  price_variance_total: string
  return_rate: string | null
  overdue_payable: string
}

/** GET /suppliers/{id}/purchase-summary (company currency, scale 2). */
export interface SupplierPurchaseSummaryData {
  party_id: string
  currency: string
  exposure: SupplierExposure
  orders: { open_count: number; open_value: string }
  invoices: {
    count: number
    invoiced_total: string
    debited_total: string
    balance_due: string
    last_invoice_date: string | null
  }
  /** Empty without purchasing.orders.view. */
  recent_orders: ApiLink[]
  /** Empty without purchasing.invoices.view. */
  recent_invoices: (ApiLink & { balance_due: string })[]
}

/** API limit per document. */
export const MAX_LINES = 500
