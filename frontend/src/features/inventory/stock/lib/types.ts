// Response shapes of the Inventory API used by the warehouse, stock, movement and lot screens
// (PHASE4 "HTTP API"). Money and quantities always travel as decimal strings.

export interface Pagination {
  current_page: number
  per_page: number
  total: number
  last_page: number
}

export interface ListResponse<T, M = object> {
  data: T[]
  meta: { pagination: Pagination } & M
}

export interface ItemResponse<T> {
  data: T
}

/** Cursor paginated list (ledger): `cursor` param in, next/prev cursors out. */
export interface CursorMeta {
  next_cursor: string | null
  prev_cursor: string | null
  per_page: number
}

export interface CursorResponse<T> {
  data: T[]
  meta: CursorMeta | { pagination: CursorMeta }
}

export type ReservationPolicy = 'none' | 'soft' | 'hard'

export const RESERVATION_POLICIES: readonly ReservationPolicy[] = ['none', 'soft', 'hard']

export interface Warehouse {
  id: string
  code: string
  name: string
  address: string | null
  is_active: boolean
  is_default: boolean
  allow_negative_stock: boolean
  reservation_policy: ReservationPolicy
  version: number
  locations_count?: number
  /** True once stock moved through it: deletion is refused, deactivate instead. */
  has_movements?: boolean
}

export interface WarehouseInput {
  code: string
  name: string
  address: string | null
  is_active: boolean
  is_default: boolean
  allow_negative_stock: boolean
  reservation_policy: ReservationPolicy
}

export interface WarehouseLocation {
  id: string
  warehouse_id: string
  code: string
  name: string
  is_active: boolean
  /** Not in the PHASE4 schema; when the API sends it, the tree follows it instead of codes. */
  parent_id?: string | null
  version?: number
}

export interface LocationInput {
  code: string
  name: string
  is_active: boolean
}

export interface CodeRef {
  id: string
  code: string
  name: string
}

export type TrackingMode = 'none' | 'lot' | 'serial'

export interface ItemRef extends CodeRef {
  tracking?: TrackingMode
  base_unit_code?: string | null
}

export interface LotRef {
  id: string
  lot_no: string
  expiry_date: string | null
}

/** Granularity of /stock-balances rows. */
export type StockGrouping = 'item_warehouse' | 'location' | 'lot'

export const STOCK_GROUPINGS: readonly StockGrouping[] = ['item_warehouse', 'location', 'lot']

export interface StockFigures {
  on_hand: string
  reserved: string
  available: string
  avg_cost: string
  value: string
}

export interface StockBalance extends StockFigures {
  item_id: string
  item: ItemRef
  warehouse_id: string
  warehouse: CodeRef
  location_id: string | null
  location?: CodeRef | null
  lot_id: string | null
  lot?: LotRef | null
  reorder_point?: string | null
}

export interface StockBalanceTotals {
  on_hand?: string
  value: string
}

export interface ItemStockWarehouse extends StockFigures {
  warehouse: CodeRef
}

export interface ItemStockLot {
  lot: LotRef
  warehouse: CodeRef
  on_hand: string
}

/** GET /items/{id}/stock */
export interface ItemStock {
  item: ItemRef & { min_stock?: string | null; reorder_point?: string | null }
  totals: StockFigures
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

export interface StockMovement {
  id: string
  seq: number
  item_id: string
  item: ItemRef
  warehouse_id: string
  warehouse: CodeRef
  location?: CodeRef | null
  lot?: LotRef | null
  serial?: { id: string; serial_no: string } | null
  movement_type: MovementType
  direction: Direction
  quantity: string
  unit_cost: string
  total_cost: string
  occurred_at: string
  document_type: string | null
  document_id: string | null
  document_number?: string | null
  document_line_id?: string | null
  journal_entry_id: string | null
  reverses_id: string | null
  created_by?: { id: string; name: string } | null
}

export interface StockLot {
  id: string
  item_id: string
  item: ItemRef
  lot_no: string
  expiry_date: string | null
  manufacture_date: string | null
  created_at: string
  /** Current quantity over all warehouses. */
  on_hand: string
}

export interface LotTraceBalance {
  warehouse: CodeRef
  location: CodeRef | null
  on_hand: string
}

/** GET /stock-lots/{id}/trace: where the lot came in and where it went. */
export interface LotTrace {
  lot: StockLot
  received: string
  issued: string
  balances: LotTraceBalance[]
  movements: StockMovement[]
}

export const SERIAL_STATUSES = ['in_stock', 'reserved', 'issued', 'scrapped'] as const
export type SerialStatus = (typeof SERIAL_STATUSES)[number]

export interface StockSerial {
  id: string
  item_id: string
  item: ItemRef
  serial_no: string
  lot_id: string | null
  lot: LotRef | null
  status: SerialStatus
  warehouse: CodeRef | null
  location: CodeRef | null
}
