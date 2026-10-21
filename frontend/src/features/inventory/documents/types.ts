// Shapes of the stock document, reservation and inventory report endpoints (Inventory module,
// /api/v1). Envelopes follow Core ApiResponse: `{data}`, lists `{data, meta: {pagination}}`.
// Money and quantities are decimal strings (quantities numeric(20,6), money numeric(20,4));
// calendar dates are "YYYY-MM-DD", timestamps ISO 8601.
import type { AuditEntry } from '@/components/shared/AuditTrail'

export interface Pagination {
  total: number
  current_page: number
  last_page: number
  per_page: number
}

export interface Paginated<T> {
  data: T[]
  meta: { pagination: Pagination }
}

export interface Envelope<T> {
  data: T
}

export const DOC_TYPES = ['receipt', 'issue', 'transfer', 'count', 'adjustment', 'opening'] as const
export type DocType = (typeof DOC_TYPES)[number]

/** Types created in the line editor; counts have their own workflow (freeze, count, post). */
export const EDITABLE_DOC_TYPES = [
  'receipt',
  'issue',
  'transfer',
  'adjustment',
  'opening',
] as const satisfies readonly DocType[]
export type EditableDocType = (typeof EDITABLE_DOC_TYPES)[number]

export const DOC_STATUSES = ['draft', 'posted', 'cancelled'] as const
export type DocStatus = (typeof DOC_STATUSES)[number]

/** Adjustment lines move stock in or out; quantities are always positive. */
export type Direction = 'in' | 'out'

export interface CodeName {
  id: string
  code: string
  name: string
}

export type TrackingMode = 'none' | 'lot' | 'serial'

/** The item fields the line editor needs (Catalog ItemResource). */
export interface ItemRef extends CodeName {
  base_unit_id: string
  base_unit?: { id: string; code: string; name: string } | null
  tracking: TrackingMode
  has_expiry: boolean
  type?: 'stock' | 'service'
}

/** A unit the line may use and its factor to the item's base unit (1 unit = factor base). */
export interface UnitChoice {
  unit_id: string
  code: string
  name: string
  factor: string
}

/** StockDocumentResource without lines (list rows carry line_count). */
export interface StockDocumentSummary {
  id: string
  doc_type: DocType
  /** Gapless per type and fiscal year, assigned at posting. */
  number: string | null
  status: DocStatus
  document_date: string
  warehouse_id: string
  target_warehouse_id: string | null
  reason: string | null
  notes: string | null
  /** Accounting offset event of issues and adjustments (e.g. inventory.scrap). */
  offset_event?: string | null
  /** Issue from expired lots (needs inventory.documents.issue_expired when posting). */
  allow_expired?: boolean
  source_type: string | null
  source_id: string | null
  journal_entry_id: string | null
  /** Count documents: when the system quantities were frozen. */
  frozen_at?: string | null
  posted_at: string | null
  posted_by?: string | null
  /** Set when a posted document was reversed: it becomes cancelled, no second document. */
  reversal_date?: string | null
  reversal_reason?: string | null
  reversal_journal_entry_id?: string | null
  reversed_at?: string | null
  reversed_by?: string | null
  created_by?: string | null
  line_count?: number
  created_at?: string | null
  updated_at?: string | null
  version: number
}

/**
 * StockDocumentLineResource. The API sends ids only; the `item_*`, `*_unit_*` and `*_code`
 * labels are filled in on the client from Catalog items, units and the warehouse locations
 * (lib/enrich.ts).
 */
export interface StockDocumentLine {
  id: string
  line_no: number
  item_id: string
  unit_id: string
  quantity: string
  /** quantity × unit factor, computed by the server. */
  base_quantity: string
  unit_cost: string | null
  /** Counts: current moving average of the item in the warehouse (values the variance). */
  avg_cost?: string
  lot_no: string | null
  expiry_date: string | null
  serial_numbers: string[]
  location_id: string | null
  /** Transfers: location in the target warehouse. */
  target_location_id?: string | null
  /** Adjustments: in or out (null on other types). */
  direction?: Direction | null
  /** Counts: frozen system quantity and the counted one (null = not counted yet). */
  system_quantity?: string | null
  counted_quantity?: string | null
  /** counted - system once counted. */
  difference?: string | null
  reservation_id?: string | null
  notes?: string | null
  // Client-side labels.
  item_code?: string | null
  item_name?: string | null
  item_tracking?: TrackingMode
  item_has_expiry?: boolean
  base_unit_id?: string | null
  base_unit_code?: string | null
  unit_code?: string | null
  location_code?: string | null
  target_location_code?: string | null
}

export interface ApiAuditRow {
  event: string | null
  description: string | null
  causer_id: string | null
  causer_name?: string | null
  created_at: string | null
}

export interface ApiStockDocument extends StockDocumentSummary {
  lines: StockDocumentLine[]
  audit?: ApiAuditRow[]
}

export interface StockDocument extends StockDocumentSummary {
  lines: StockDocumentLine[]
  audit?: AuditEntry[]
}

export interface StockLineInput {
  item_id: string
  unit_id: string
  quantity: string
  unit_cost: string | null
  lot_no: string | null
  expiry_date: string | null
  serial_numbers: string[]
  location_id: string | null
  target_location_id: string | null
  /** Adjustments only. */
  direction?: Direction
  notes: string | null
}

export interface StockDocumentInput {
  doc_type: EditableDocType
  document_date: string
  warehouse_id: string
  target_warehouse_id: string | null
  reason: string | null
  notes: string | null
  /** Issues and transfers only (expired lots may then be issued by a permitted poster). */
  allow_expired?: boolean
  lines: StockLineInput[]
}

/**
 * POST /stock-documents with doc_type count: with freeze (default true) the server snapshots the
 * warehouse's non-zero balances (optionally only `item_ids`) as uncounted lines.
 */
export interface CountStartInput {
  doc_type: 'count'
  document_date: string
  warehouse_id: string
  freeze: boolean
  item_ids?: string[]
  notes: string | null
}

/** A line for stock found outside the snapshot (system quantity = on hand when added). */
export interface CountAddInput {
  item_id: string
  unit_id?: string | null
  location_id: string | null
  lot_no: string | null
  expiry_date?: string | null
  unit_cost?: string | null
  counted_quantity: string
}

/** PATCH /stock-documents/{id}/counts: counted quantities by line (null clears) and new lines. */
export interface CountUpdateInput {
  version: number
  counts: { line_id: string; counted_quantity: string | null }[]
  add?: CountAddInput[]
}

export interface ReverseInput {
  date: string
  reason: string
  version: number
}

/** POST /stock-documents/{id}/import (count and opening drafts), dry run or applied. */
export interface ImportResult {
  /** Data rows read from the file. */
  rows: number
  valid: number
  errors: { row: number; field: string; message: string }[]
  /** False on a dry run or when any row failed. */
  applied: boolean
}

export const RESERVATION_STATUSES = ['active', 'released', 'consumed', 'expired'] as const
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

/** StockReservationResource; item, warehouse and lot labels are resolved on the client. */
export interface StockReservation {
  id: string
  item_id: string
  warehouse_id: string
  lot_id: string | null
  quantity: string
  status: ReservationStatus
  source_type: string | null
  source_id: string | null
  expires_at: string | null
  closed_at?: string | null
  notes: string | null
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
  version: number
}

export interface ReservationInput {
  item_id: string
  warehouse_id: string
  lot_id: string | null
  quantity: string
  expires_at: string | null
  notes: string | null
}

/** API limit per document. */
export const MAX_LINES = 500
