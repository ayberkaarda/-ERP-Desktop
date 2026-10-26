// Sales returns (/sales-returns): draft -> approved (numbered) -> received (return_in stock at the
// original cost, COGS reversed) -> credited (credit note issued). Wire and screen shapes.
import type {
  ApiDetailExtras,
  ApiHeader,
  ApiLine,
  DocLink,
  LineLabels,
  SalesHeader,
} from '../invoices/kit/types'

export const RETURN_STATUSES = ['draft', 'approved', 'received', 'credited', 'cancelled'] as const
export type ReturnStatus = (typeof RETURN_STATUSES)[number]

interface ReturnFields {
  status: ReturnStatus
  invoice_id: string
  reason: string | null
  stock_document_id: string | null
  /** COGS reversal booked with the return_in movement. */
  journal_entry_id: string | null
  credit_invoice_id: string | null
  approved_at: string | null
  received_at: string | null
  credited_at: string | null
  cancelled_at: string | null
}

/** A list row (GET /sales-returns). */
export type ReturnSummary = Omit<SalesHeader, 'status'> & ReturnFields

export interface ApiReturnLine extends ApiLine {
  invoice_line_id: string
  delivery_line_id: string | null
  lot_no: string | null
  serial_numbers: string[] | null
  unit_cost: string | null
  cost_total: string | null
}

export type RawReturn = Omit<ApiHeader, 'status'> &
  ReturnFields &
  ApiDetailExtras & { lines: ApiReturnLine[] }

export interface ReturnLine extends Omit<ApiReturnLine, 'serial_numbers'>, LineLabels {
  serial_numbers: string[]
}

export type ReturnDetail = ReturnSummary & {
  lines: ReturnLine[]
  links: DocLink[]
  /** From the chain (detail only). */
  invoice_number?: string | null
  credit_invoice_number?: string | null
}

export interface ReturnLineInput {
  invoice_line_id: string
  quantity: string
  lot_no: string | null
  serial_numbers: string[]
}

/** POST /sales-invoices/{id}/returns (Idempotency-Key). */
export interface ReturnInput {
  document_date: string
  warehouse_id: string | null
  reason: string | null
  notes: string | null
  lines: ReturnLineInput[]
}

/** approve / receive / credit / cancel bodies (version guards against a stale copy). */
export interface ReturnActionInput {
  version: number
}

export type ReturnAction = 'approve' | 'receive' | 'credit' | 'cancel'
