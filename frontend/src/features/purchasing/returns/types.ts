// Purchase returns (/purchase-returns): goods sent back from a booked invoice or a posted receipt.
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

export const RETURN_STATUSES = ['draft', 'approved', 'shipped', 'debited', 'cancelled'] as const
export type ReturnStatus = (typeof RETURN_STATUSES)[number]

interface ReturnFields {
  status: ReturnStatus
  invoice_id: string | null
  receipt_id: string | null
  reason: string | null
  /** Stock issue (return_out) posted at shipping. */
  stock_document_id: string | null
  /** Cost correction entry (GRNI vs price variance) posted at shipping. */
  journal_entry_id: string | null
  /** Debit note (purchase invoice of type return) created at debit. */
  debit_invoice_id: string | null
  approved_at: string | null
  shipped_at: string | null
  debited_at: string | null
  cancelled_at: string | null
}

export type ReturnSummary = Omit<ApiHeader, 'status'> & ReturnFields

export interface ApiReturnLine extends ApiLine {
  invoice_line_id: string | null
  receipt_line_id: string | null
  lot_no: string | null
  serial_numbers: string[] | null
  /** Stock cost of the issue (after shipping). */
  unit_cost: string | null
  cost_total: string | null
  /** Original receipt value the GRNI accrual moves by. */
  receipt_cost: string | null
}

export type RawReturn = Omit<ApiHeader, 'status'> &
  ReturnFields &
  ApiDetailExtras & { lines: ApiReturnLine[] }

export type ReturnLine = Omit<ApiReturnLine, 'serial_numbers'> &
  LineLabels & { serial_numbers: string[] }

export type PurchaseReturn = ReturnSummary & {
  party_snapshot: PartySnapshot
  lines: ReturnLine[]
  links: DocLink[]
  raw_links: ApiLinks
  warnings?: DocWarning[]
  audit?: AuditEntry[]
}

export type ReturnAction = 'approve' | 'ship' | 'debit' | 'cancel'

export interface ReturnLineInput {
  invoice_line_id?: string
  receipt_line_id?: string
  quantity: string
  lot_no: string | null
  serial_numbers: string[]
}

/** POST /purchase-invoices/{id}/returns and /purchase-receipts/{id}/returns. */
export interface ReturnCreateInput {
  document_date: string
  warehouse_id: string | null
  reason: string | null
  notes: string | null
  lines: ReturnLineInput[]
}
