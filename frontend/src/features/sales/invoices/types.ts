// Sales invoices and credit notes (/sales-invoices). Shapes mirror PHASE5 and are listed in
// .orchestra/fe-sales2.md for the integration lane.
import type { ApiAuditRow, DocLink, DocWarning, SalesHeader, SalesTotals } from './kit/types'

export const INVOICE_STATUSES = [
  'draft',
  'pending_approval',
  'issued',
  'partially_paid',
  'paid',
  'cancelled',
  'reversed',
] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const INVOICE_TYPES = ['sale', 'return'] as const
export type InvoiceType = (typeof INVOICE_TYPES)[number]

/** Statuses with a posted journal entry and an open or settled balance. */
export const POSTED_STATUSES: readonly InvoiceStatus[] = ['issued', 'partially_paid', 'paid']

export interface InvoiceSummary extends SalesHeader, SalesTotals {
  status: InvoiceStatus
  invoice_type: InvoiceType
  due_date: string | null
  payment_term_id: string | null
  price_list_id: string | null
  /** Maintained by the server (treasury applies payments from Phase 7). */
  paid_amount: string
  balance_due: string
  journal_entry_id: string | null
  reversal_journal_entry_id?: string | null
  issued_at?: string | null
  reversed_at?: string | null
  reversal_reason?: string | null
  /** Reserved for Phase 9 e-documents. */
  e_document_status?: string | null
  line_count?: number
}

export interface InvoiceLine {
  id: string
  line_no: number
  item_id: string | null
  item_code?: string | null
  item_name?: string | null
  item_type?: 'stock' | 'service' | null
  variant_id?: string | null
  description: string | null
  quantity: string
  unit_id: string
  unit_code?: string | null
  base_quantity?: string
  unit_price: string
  discount_percent: string
  discount_amount: string
  net_amount: string
  tax_code_id: string | null
  /** Snapshot at the document date. */
  tax_rate: string
  tax_amount: string
  line_total: string
  warehouse_id?: string | null
  delivery_line_id: string | null
  source_line_id: string | null
  price_source?: string | null
  /** Already credited by returns (read by the return flow). */
  returned_quantity?: string
}

export interface ApiInvoice extends InvoiceSummary {
  /** Stock-tracked goods without a delivery post one automatically when issued. */
  deliver_on_invoice?: boolean
  lines: InvoiceLine[]
  links?: DocLink[]
  warnings?: DocWarning[]
  audit?: ApiAuditRow[]
}

export interface InvoiceLineInput {
  item_id: string | null
  description: string | null
  quantity: string
  unit_id: string
  /** null: the server resolves the price (PriceResolver) and records its source. */
  unit_price: string | null
  discount_percent: string
  discount_amount: string
  tax_code_id: string | null
  delivery_line_id: string | null
  source_line_id: string | null
}

/** POST /sales-invoices (draft, Idempotency-Key) and PATCH /sales-invoices/{id} (+ version). */
export interface InvoiceInput {
  party_id: string
  invoice_type: InvoiceType
  document_date: string
  due_date: string | null
  currency_code: string
  /** null: the server takes the day's rate (1 for the company currency). */
  fx_rate: string | null
  payment_term_id: string | null
  warehouse_id: string | null
  notes: string | null
  internal_notes: string | null
  deliver_on_invoice: boolean
  lines: InvoiceLineInput[]
}

/** POST /sales-documents/preview-totals: totals and resolved prices, nothing stored. */
export interface PreviewInput {
  document_type: 'sales_invoice'
  party_id: string | null
  document_date: string
  currency_code: string
  fx_rate: string | null
  lines: InvoiceLineInput[]
}

export interface PreviewLine {
  unit_price: string
  price_source: string | null
  tax_rate: string
  net_amount: string
  tax_amount: string
  line_total: string
}

export interface PreviewResult extends SalesTotals {
  lines: PreviewLine[]
  warnings?: DocWarning[]
}

/** POST /sales-invoices/{id}/issue; over-limit issues need sales.credit_override + reason. */
export interface IssueInput {
  version: number
  credit_override_reason?: string
}

/** POST /sales-invoices/{id}/reverse: reversing journal; stock only when asked and allowed. */
export interface InvoiceReverseInput {
  version: number
  date: string
  reason: string
  reverse_stock: boolean
}

/** POST /sales-orders/{id}/invoices and POST /sales-deliveries/{id}/invoice bodies. */
export interface InvoiceFromSourceInput {
  document_date: string
  /** Omitted: everything still invoiceable. */
  lines?: { source_line_id: string; quantity: string }[]
}
