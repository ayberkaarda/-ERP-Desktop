// Sales returns (/sales-returns): draft -> approved -> received (return_in stock at the original
// cost) -> credited (credit note, COGS reversed). Shapes listed in .orchestra/fe-sales2.md.
import type { ApiAuditRow, DocLink, DocWarning, SalesHeader } from '../invoices/kit/types'

export const RETURN_STATUSES = ['draft', 'approved', 'received', 'credited', 'cancelled'] as const
export type ReturnStatus = (typeof RETURN_STATUSES)[number]

export interface ReturnSummary extends SalesHeader {
  status: ReturnStatus
  invoice_id: string
  invoice_number?: string | null
  reason: string | null
  received_at?: string | null
  stock_document_id?: string | null
  credit_invoice_id?: string | null
  credit_invoice_number?: string | null
  /** Value of the returned lines at the invoice prices (document currency). */
  total?: string | null
  line_count?: number
}

export interface ReturnLine {
  id: string
  line_no: number
  invoice_line_id: string
  delivery_line_id: string | null
  item_id: string | null
  item_code?: string | null
  item_name?: string | null
  description: string | null
  quantity: string
  unit_id: string
  unit_code?: string | null
  unit_price?: string | null
  line_total?: string | null
  lot_no: string | null
  serial_numbers: string[]
  reason: string | null
}

export interface ApiReturn extends ReturnSummary {
  lines: ReturnLine[]
  links?: DocLink[]
  warnings?: DocWarning[]
  audit?: ApiAuditRow[]
}

export interface ReturnLineInput {
  invoice_line_id: string
  quantity: string
  reason: string | null
  lot_no: string | null
  serial_numbers: string[]
}

/** POST /sales-invoices/{id}/returns (Idempotency-Key). */
export interface ReturnInput {
  document_date: string
  warehouse_id: string
  reason: string | null
  notes: string | null
  lines: ReturnLineInput[]
}

/** approve / receive / credit / cancel bodies. */
export interface ReturnActionInput {
  version: number
  date?: string
  reason?: string
}

export type ReturnAction = 'approve' | 'receive' | 'credit' | 'cancel'
