// Supplier invoices and debit notes (/purchase-invoices) as the Purchasing API sends them and as
// the screens use them after labelling.
import type { AuditEntry } from '@/components/shared/AuditTrail'
import type {
  ApiDetailExtras,
  ApiHeader,
  ApiLine,
  ApiLinks,
  DocLink,
  DocWarning,
  LineLabels,
  PartySnapshot,
} from './kit/types'
import type { MatchResult, MatchStatus } from './lib/match'

export const INVOICE_STATUSES = [
  'draft',
  'pending_approval',
  'booked',
  'partially_paid',
  'paid',
  'cancelled',
  'reversed',
] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

/** Statuses with a journal entry and a payable balance. */
export const BOOKED_STATUSES: readonly string[] = ['booked', 'partially_paid', 'paid']

export const INVOICE_TYPES = ['purchase', 'return'] as const
export type InvoiceType = (typeof INVOICE_TYPES)[number]

interface InvoiceFields {
  status: InvoiceStatus
  invoice_type: InvoiceType
  /** The supplier's own number; unique per supplier while not cancelled/reversed. */
  supplier_invoice_no: string | null
  order_id: string | null
  receipt_id: string | null
  return_id: string | null
  original_invoice_id: string | null
  receive_on_invoice: boolean
  journal_entry_id: string | null
  reversal_journal_entry_id: string | null
  /** total - withholding_total: what the supplier is owed. */
  payable_total: string
  paid_amount: string
  balance_due: string
  match_status: MatchStatus | null
  match_override_reason: string | null
  match_override_by: string | null
  approval_request_id: string | null
  approval_comment: string | null
  approved_at: string | null
  booked_at: string | null
  booked_by: string | null
  reversed_at: string | null
  reversal_date: string | null
  reversal_reason: string | null
  e_document_status: string | null
  e_document_uuid: string | null
}

/** A list row (GET /purchase-invoices). */
export type InvoiceSummary = Omit<ApiHeader, 'status'> & InvoiceFields

export interface ApiInvoiceLine extends ApiLine {
  /** Available for a new return after active return reservations. */
  returnable_quantity?: string
  order_line_id: string | null
  receipt_line_id: string | null
  /** Debit notes: the line of the original invoice. */
  original_line_id: string | null
  match_status: MatchStatus | null
  match_details: Record<string, unknown> | null
  net_local: string
  grni_amount: string
  variance_amount: string
  expense_amount: string
}

export type RawInvoice = Omit<ApiHeader, 'status'> &
  InvoiceFields &
  ApiDetailExtras & { lines: ApiInvoiceLine[]; match?: unknown }

export type InvoiceLine = ApiInvoiceLine & LineLabels

export type Invoice = InvoiceSummary & {
  party_snapshot: PartySnapshot
  lines: InvoiceLine[]
  links: DocLink[]
  raw_links: ApiLinks
  warnings?: DocWarning[]
  audit?: AuditEntry[]
  match: MatchResult | null
}

/** One sent line: a direct item line or a line taken from a receipt/order line. */
export interface InvoiceLineInput {
  item_id?: string
  receipt_line_id?: string
  order_line_id?: string
  description?: string | null
  quantity: string
  unit_id?: string
  unit_price?: string | null
  discount_percent?: string
  discount_amount?: string
  tax_code_id?: string | null
  withholding_code_id?: string | null
  tax_inclusive?: boolean
  variant_id?: string | null
  warehouse_id?: string | null
}

/** POST /purchase-invoices (direct) and PATCH /purchase-invoices/{id} (with version). */
export interface InvoiceInput {
  party_id: string
  supplier_invoice_no: string | null
  document_date: string
  due_date: string | null
  currency_code: string
  fx_rate: string | null
  payment_term_id: string | null
  warehouse_id: string | null
  notes: string | null
  internal_notes: string | null
  receive_on_invoice: boolean
  lines: InvoiceLineInput[]
}

/** POST /purchase-receipts/{id}/invoice: lines omitted = everything still open. */
export interface InvoiceFromReceiptInput {
  document_date: string
  due_date: string | null
  supplier_invoice_no: string | null
  notes: string | null
}

export interface BookInput {
  version: number
  match_override_reason?: string
}

export interface ReverseInput {
  version: number
  date: string
  reason: string
  reverse_stock: boolean
}

/** POST /purchase-documents/preview-totals: item lines only (sources are priced by the server). */
export interface PreviewInput {
  party_id: string
  document_date: string
  currency_code: string
  fx_rate: string | null
  lines: {
    item_id: string
    quantity: string
    unit_id: string
    unit_price: string | null
    discount_percent: string
    discount_amount: string
    tax_code_id: string | null
    withholding_code_id: string | null
    tax_inclusive: boolean
    variant_id: string | null
  }[]
}

export interface PreviewLine {
  unit_price: string
  price_source: string | null
  tax_rate: string
  withholding_rate: string | null
  net_amount: string | null
  tax_amount: string | null
  withholding_amount: string | null
  line_total: string | null
}

export interface RawPreview {
  header: Record<string, unknown>
  lines: Record<string, unknown>[]
  taxes: Record<string, unknown>[]
  totals: {
    subtotal: string
    discount_total: string
    tax_total: string
    total: string
    withholding_total: string
    total_local?: string
  }
}

export interface PreviewResult {
  subtotal: string
  discount_total: string
  tax_total: string
  total: string
  withholding_total: string
  total_local?: string
  lines: PreviewLine[]
  warnings: DocWarning[]
}
