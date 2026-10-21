// Shapes of the stock document, reservation and inventory report endpoints (PHASE4 HTTP API).
// The backend lane builds them in parallel: field names follow the PHASE4 data model and the
// conventions of earlier modules (ApiResponse envelopes, ListQuery filters, HasVersion). Money
// and quantities are decimal strings (quantities numeric(20,6), money numeric(20,4)); calendar
// dates are "YYYY-MM-DD".
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

export interface CodeName {
  id: string
  code: string
  name: string
}

/** GET /warehouses row (only what the documents need). */
export interface WarehouseRef extends CodeName {
  is_active: boolean
  is_default: boolean
  allow_negative_stock?: boolean
}

/** GET /warehouses/{id}/locations row. */
export interface LocationRef extends CodeName {
  warehouse_id: string
  is_active: boolean
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

export interface StockDocumentSummary {
  id: string
  doc_type: DocType
  /** Gapless per type and fiscal year, assigned at posting. */
  number: string | null
  status: DocStatus
  document_date: string
  warehouse_id: string
  warehouse_code?: string | null
  warehouse_name?: string | null
  target_warehouse_id: string | null
  target_warehouse_code?: string | null
  target_warehouse_name?: string | null
  reason: string | null
  notes: string | null
  source_type: string | null
  source_id: string | null
  journal_entry_id: string | null
  posted_at: string | null
  posted_by?: string | null
  /** Set when a posted document was reversed (status becomes cancelled). */
  reversed_at?: string | null
  reversal_reason?: string | null
  reversal_date?: string | null
  /** Count documents: when the system quantities were frozen. */
  frozen_at?: string | null
  line_count?: number
  /** Sum of line costs where known (receipts, openings, posted documents). */
  total_cost?: string | null
  created_at?: string
  version: number
}

export interface StockDocumentLine {
  id: string
  line_no: number
  item_id: string
  item_code?: string | null
  item_name?: string | null
  /** Echoed by the API so the editor knows tracking rules without another lookup. */
  item_tracking?: TrackingMode
  item_has_expiry?: boolean
  base_unit_id?: string | null
  base_unit_code?: string | null
  unit_id: string
  unit_code?: string | null
  quantity: string
  /** quantity × unit factor, computed by the server. */
  base_quantity: string
  unit_cost: string | null
  total_cost?: string | null
  lot_no: string | null
  expiry_date: string | null
  serial_numbers: string[]
  location_id: string | null
  location_code?: string | null
  /** Transfers: location in the target warehouse. */
  target_location_id?: string | null
  target_location_code?: string | null
  /** Counts: frozen system quantity and the counted one (null = not counted yet). */
  system_quantity?: string | null
  counted_quantity?: string | null
  notes?: string | null
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
  notes: string | null
}

export interface StockDocumentInput {
  doc_type: EditableDocType
  document_date: string
  warehouse_id: string
  target_warehouse_id: string | null
  reason: string | null
  notes: string | null
  lines: StockLineInput[]
}

/** POST /stock-documents with doc_type count: the server freezes system quantities. */
export interface CountStartInput {
  doc_type: 'count'
  document_date: string
  warehouse_id: string
  freeze: true
  location_id: string | null
  category_id: string | null
  /** Also list items with zero system quantity (blind counts of the whole catalog). */
  include_zero: boolean
  notes: string | null
}

/** PATCH of a count draft: counted quantities by line id (null clears the count). */
export interface CountUpdateInput {
  version: number
  lines: { id: string; counted_quantity: string | null }[]
}

export interface ReverseInput {
  date: string
  reason: string
  version: number
}

/** Result row of the count CSV import (dry run or applied). */
export interface ImportRow {
  row: number
  item_code: string | null
  lot_no: string | null
  location_code: string | null
  counted_quantity: string | null
  line_id: string | null
  status: 'ok' | 'error'
  message: string | null
}

export interface ImportResult {
  dry_run: boolean
  rows: ImportRow[]
  valid: number
  invalid: number
  /** Present once applied (dry_run false): the updated count document. */
  document?: ApiStockDocument | null
}

export const RESERVATION_STATUSES = ['active', 'released', 'consumed', 'expired'] as const
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

export interface StockReservation {
  id: string
  item_id: string
  item_code?: string | null
  item_name?: string | null
  warehouse_id: string
  warehouse_code?: string | null
  lot_id: string | null
  lot_no?: string | null
  quantity: string
  unit_code?: string | null
  status: ReservationStatus
  source_type: string | null
  source_id: string | null
  /** Human reference of the source document when the server can resolve it. */
  source_label?: string | null
  expires_at: string | null
  created_by?: string | null
  created_at?: string
  version: number
}

/** API limit per document. */
export const MAX_LINES = 500
