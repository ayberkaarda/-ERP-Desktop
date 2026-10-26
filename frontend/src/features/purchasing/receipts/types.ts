// Goods receipts (/purchase-receipts) and the order fields the receipt editor reads.
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
} from '../invoices/kit/types'

export const RECEIPT_STATUSES = ['draft', 'posted', 'cancelled'] as const
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number]

interface ReceiptFields {
  status: ReceiptStatus
  /** null for a direct receipt (purchasing.allow_direct_receipt). */
  order_id: string | null
  /** Invoice that posted this receipt itself (receive on invoice). */
  invoice_id: string | null
  supplier_reference: string | null
  stock_document_id: string | null
  /** Dr inventory / Cr goods received not invoiced, posted with the stock. */
  journal_entry_id: string | null
  /** Company currency at the order cost. */
  cost_total: string
  posted_at: string | null
  posted_by: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  reversal_stock_document_id: string | null
  reversal_date: string | null
}

/** A list row (GET /purchase-receipts). */
export type ReceiptSummary = Omit<ApiHeader, 'status'> & ReceiptFields

export interface ApiReceiptLine extends ApiLine {
  /** Available for a new return after invoice and return reservations. */
  returnable_quantity?: string
  order_line_id: string | null
  lot_no: string | null
  expiry_date: string | null
  serial_numbers: string[] | null
  location_id: string | null
  /** Company currency per base unit, after posting. */
  unit_cost: string | null
  cost_total: string | null
}

export type RawReceipt = Omit<ApiHeader, 'status'> &
  ReceiptFields &
  ApiDetailExtras & { lines: ApiReceiptLine[] }

export type ReceiptLine = Omit<ApiReceiptLine, 'serial_numbers'> &
  LineLabels & { serial_numbers: string[] }

export type Receipt = ReceiptSummary & {
  party_snapshot: PartySnapshot
  lines: ReceiptLine[]
  links: DocLink[]
  raw_links: ApiLinks
  warnings?: DocWarning[]
  audit?: AuditEntry[]
}

/** Tracking columns of a receipt line. */
export interface TrackingInput {
  lot_no: string | null
  expiry_date: string | null
  serial_numbers: string[]
  location_id: string | null
}

/** Lines of a receipt taken from an order (item, unit, price come from the order line). */
export interface OrderReceiptLineInput extends TrackingInput {
  order_line_id: string
  quantity: string
}

/** Lines of a direct receipt (no order): the item line with its price. */
export interface DirectReceiptLineInput extends TrackingInput {
  item_id: string
  unit_id: string
  quantity: string
  unit_price: string
  tax_code_id: string | null
  description: string | null
  variant_id: string | null
  tax_inclusive: boolean
  discount_percent: string
  discount_amount: string
  withholding_code_id: string | null
}

/** POST /purchase-orders/{id}/receipts. */
export interface ReceiptFromOrderInput {
  document_date: string
  warehouse_id: string
  supplier_reference: string | null
  notes: string | null
  lines: OrderReceiptLineInput[]
}

/** POST /purchase-receipts (direct) and PATCH /purchase-receipts/{id} (+version). */
export interface ReceiptInput {
  party_id?: string
  currency_code?: string
  document_date: string
  warehouse_id: string
  supplier_reference: string | null
  notes: string | null
  lines: (OrderReceiptLineInput | DirectReceiptLineInput)[]
}

/** POST /purchase-receipts/{id}/cancel: drafts are cancelled, posted ones reversed (reason). */
export interface CancelInput {
  version: number
  reason?: string
  date?: string
}

/** Order line as GET /purchase-orders/{id} sends it. */
export interface ApiOrderLine extends ApiLine {
  received_quantity: string
  invoiced_quantity: string
  expected_date: string | null
}

export interface RawOrder extends ApiDetailExtras {
  id: string
  number: string | null
  status: string
  party_id: string
  party_name: string | null
  warehouse_id: string | null
  currency_code: string
  document_date: string
  lines: ApiOrderLine[]
}

export type OrderSourceLine = ApiOrderLine & LineLabels

export interface OrderSource {
  id: string
  number: string | null
  status: string
  party_id: string
  party_name: string | null
  warehouse_id: string | null
  currency_code: string
  lines: OrderSourceLine[]
}
