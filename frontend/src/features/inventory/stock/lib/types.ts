// Response shapes of the Inventory API used by the stock, movement and lot screens, as sent by
// backend Modules/Inventory (StockBalanceResource, StockMovementResource, StockLotResource,
// StockSerialResource, StockBalanceController::item, TraceController::lotTrace). Money and
// quantities always travel as decimal strings. Warehouses: see ../../shared/warehouses.ts.

export interface Pagination {
  current_page: number
  per_page: number
  total: number
  last_page: number
}

export interface ListResponse<T> {
  data: T[]
  meta: { pagination: Pagination }
}

export interface ItemResponse<T> {
  data: T
}

/** GET /stock-movements meta: pass next_cursor (a seq) back as `cursor`; null on the last page. */
export interface CursorMeta {
  next_cursor: number | null
  per_page: number
}

export interface CursorResponse<T> {
  data: T[]
  meta: CursorMeta
}

export interface CodeRef {
  id: string
  code: string
  name: string
}

/**
 * Granularity of /stock-balances rows (`group_by`): item x warehouse (default), item over all
 * warehouses, or item x warehouse x location x lot.
 */
export type StockGrouping = 'warehouse' | 'item' | 'detail'

export const STOCK_GROUPINGS: readonly StockGrouping[] = ['warehouse', 'item', 'detail']

export interface StockFigures {
  on_hand: string
  reserved: string
  available: string
  avg_cost: string
  value: string
}

/** One stock status row. Warehouse fields are null when grouped by item. */
export interface StockBalance extends StockFigures {
  item_id: string
  item_code: string
  item_name: string
  base_unit_id: string
  warehouse_id: string
  warehouse_code: string | null
  warehouse_name: string | null
  location_id: string | null
  location_code: string | null
  lot_id: string | null
  lot_no: string | null
  expiry_date: string | null
}

export interface ItemStockWarehouse extends StockFigures {
  warehouse_id: string
  warehouse_code: string | null
  warehouse_name: string | null
}

/** Lot totals of one item over all warehouses. */
export interface ItemStockLot {
  lot_id: string
  lot_no: string
  expiry_date: string | null
  on_hand: string
  reserved: string
  available: string
}

/** GET /items/{id}/stock */
export interface ItemStock extends StockFigures {
  item_id: string
  item_code: string
  item_name: string
  base_unit_id: string | null
  warehouses: ItemStockWarehouse[]
  lots: ItemStockLot[]
}

export const MOVEMENT_TYPES = [
  'receipt',
  'issue',
  'transfer_out',
  'transfer_in',
  'count_adjustment',
  'opening',
  'return_in',
  'return_out',
  'production_in',
  'production_out',
  'scrap',
] as const

export type MovementType = (typeof MOVEMENT_TYPES)[number]

export type Direction = 'in' | 'out'

/** One ledger row; references are ids plus the item, lot, serial and document numbers. */
export interface StockMovement {
  id: string
  seq: number
  item_id: string
  item_code: string | null
  item_name: string | null
  warehouse_id: string
  location_id: string | null
  lot_id: string | null
  lot_no: string | null
  serial_id: string | null
  serial_no: string | null
  movement_type: MovementType
  direction: Direction
  /** Always positive; signed_quantity is negative for outbound rows. */
  quantity: string
  signed_quantity: string
  unit_cost: string
  total_cost: string
  /** Posting date, YYYY-MM-DD. */
  occurred_at: string
  document_type: string
  document_id: string
  document_number: string | null
  document_doc_type: string | null
  document_line_id: string | null
  journal_entry_id: string | null
  reverses_id: string | null
  /** User id. */
  created_by: string | null
  created_at: string | null
}

export interface StockLot {
  id: string
  item_id: string
  item_code: string | null
  item_name: string | null
  lot_no: string
  expiry_date: string | null
  manufacture_date: string | null
  /** Current quantity over all warehouses. */
  on_hand: string
  is_expired: boolean
  created_at: string | null
}

/** Received and issued totals of a lot in one warehouse. */
export interface LotTraceSummary {
  warehouse_id: string
  received: string
  issued: string
  on_hand: string
}

/** GET /stock-lots/{id}/trace: the lot, per-warehouse totals and every movement in order. */
export interface LotTrace {
  lot: StockLot
  summary: LotTraceSummary[]
  movements: StockMovement[]
}

export const SERIAL_STATUSES = ['in_stock', 'reserved', 'issued', 'scrapped'] as const
export type SerialStatus = (typeof SERIAL_STATUSES)[number]

export interface StockSerial {
  id: string
  item_id: string
  item_code: string | null
  item_name: string | null
  serial_no: string
  lot_id: string | null
  lot_no: string | null
  status: SerialStatus
  warehouse_id: string | null
  location_id: string | null
  created_at: string | null
  updated_at: string | null
}
