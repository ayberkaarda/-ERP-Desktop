// Sales invoices and credit notes (/sales-invoices) as the Sales API sends them and as the screens
// use them after labelling.
import type {
  ApiDetailExtras,
  ApiHeader,
  ApiLine,
  DocLink,
  DocWarning,
  LineLabels,
  SalesHeader,
  SalesTotals,
} from './kit/types'

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

interface InvoiceFields {
  status: InvoiceStatus
  invoice_type: InvoiceType
  order_id: string | null
  delivery_id: string | null
  /** Credit notes: the return they credit and the invoice they correct. */
  return_id: string | null
  original_invoice_id: string | null
  /** Stock-tracked goods without a delivery post one automatically when issued. */
  deliver_on_invoice: boolean
  journal_entry_id: string | null
  reversal_journal_entry_id: string | null
  /** Maintained by the server (treasury applies payments from Phase 7). */
  paid_amount: string
  balance_due: string
  issued_at: string | null
  issued_by: string | null
  reversed_at: string | null
  reversal_date: string | null
  reversal_reason: string | null
  credit_override_reason: string | null
  /** Reserved for Phase 9 e-documents. */
  e_document_status: string | null
  e_document_uuid: string | null
}

/** A list row (GET /sales-invoices). */
export type InvoiceSummary = Omit<SalesHeader, 'status'> & InvoiceFields

export interface ApiInvoiceLine extends ApiLine {
  order_line_id: string | null
  delivery_line_id: string | null
  /** Credit notes: the sale invoice line credited. */
  original_line_id: string | null
}

export type RawInvoice = Omit<ApiHeader, 'status'> &
  InvoiceFields &
  ApiDetailExtras & { lines: ApiInvoiceLine[] }

export type InvoiceLine = ApiInvoiceLine & LineLabels

export type InvoiceDetail = InvoiceSummary & {
  lines: InvoiceLine[]
  links: DocLink[]
  warnings?: DocWarning[]
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
  order_line_id: string | null
}

/** POST /sales-invoices (draft, Idempotency-Key) and PATCH /sales-invoices/{id} (+ version). */
export interface InvoiceInput {
  party_id: string
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

/** POST /sales-documents/preview-totals body (header like a draft; lines need an item). */
export interface PreviewInput {
  party_id: string | null
  document_date: string
  currency_code: string
  fx_rate: string | null
  payment_term_id?: string | null
  warehouse_id?: string | null
  lines: {
    item_id: string
    quantity: string
    unit_id: string
    unit_price: string | null
    discount_percent: string
    discount_amount: string
    tax_code_id: string | null
  }[]
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

/** Wire answer of preview-totals: `{header, lines, taxes, totals, price_overrides}`. */
export interface RawPreview {
  header: Record<string, unknown>
  lines: (Record<string, unknown> & {
    unit_price: string
    price_source: string | null
    tax_rate: string
    net_amount: string
    tax_amount: string
    line_total: string
  })[]
  taxes: { tax_code_id: string | null; rate: string; base: string; tax: string }[]
  totals: SalesTotals
  price_overrides: { line: number; resolved: string; given: string }[]
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

/** POST /sales-deliveries/{id}/invoice body; omitted lines = everything not invoiced yet. */
export interface InvoiceFromDeliveryInput {
  document_date: string
  due_date?: string | null
  notes?: string | null
  lines?: { delivery_line_id: string; quantity: string }[]
}
