import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import type { StockWarehouse, WarehouseLocationRef } from '@/features/inventory/shared/warehouses'
import type {
  ItemStock,
  StockBalance,
  StockLot,
  StockMovement,
  StockSerial,
} from '@/features/inventory/stock/lib/types'
import { addDays, toIsoDate } from '@/lib/datetime'
import { ITEM_BOLT } from './catalog'

// In-memory stand-in for the Inventory endpoints used by the warehouse, stock status, movement
// and lot/serial screens, mirroring backend Modules/Inventory: WarehouseController
// (/stock-warehouses), StockBalanceController, StockMovementController, TraceController and
// InventoryController (filter allow-lists -> 422 filter.x, sort allow-lists -> 422 sort,
// per_page caps). Locations come from Reference (/warehouses/{id}/locations).

export interface InventoryStockDb {
  warehouses: StockWarehouse[]
  /** Warehouse ids with stock movements (has_movements on GET /stock-warehouses/{id}). */
  movedWarehouses: string[]
  locations: WarehouseLocationRef[]
  /** Finest balance rows (item x warehouse x location x lot); lists group them. */
  balances: StockBalance[]
  itemStock: Record<string, ItemStock>
  movements: StockMovement[]
  lots: StockLot[]
  serials: StockSerial[]
  calls: { method: string; path: string; body: unknown; headers: Headers; url: URL }[]
}

const API = '*/api/v1'

function error(status: number, code: string, message: string, fields?: Record<string, string[]>) {
  return HttpResponse.json({ errors: { message, code, ...(fields ? { fields } : {}) } }, { status })
}
const validation = (fields: Record<string, string[]>) =>
  error(422, 'VALIDATION_ERROR', Object.values(fields)[0]?.[0] ?? 'Geçersiz bilgi.', fields)
const notFound = () => error(404, 'NOT_FOUND', 'Kayıt bulunamadı.')
const conflict = () =>
  error(409, 'VERSION_CONFLICT', 'Kayıt siz düzenlerken başka biri tarafından değiştirildi.')

export const WH_MAIN = 'wh-main'
export const WH_SHOP = 'wh-shop'
export const ITEM_GLOVE = 'item-glove'
export const LOT_OLD = 'lot-old'
export const LOT_NEW = 'lot-new'
export const DOC_RECEIPT = 'doc-receipt-1'
export const JE_RECEIPT = 'je-receipt-1'

const today = () => toIsoDate(new Date())

function warehouse(
  over: Partial<StockWarehouse> & Pick<StockWarehouse, 'id' | 'code' | 'name'>,
): StockWarehouse {
  return {
    is_active: true,
    is_default: false,
    negative_stock_policy: 'block',
    allow_negative_stock: false,
    reservation_policy: 'soft',
    version: 1,
    ...over,
  }
}

const bolt = { item_id: ITEM_BOLT, item_code: 'STK000001', item_name: 'Cıvata M8' }
const glove = { item_id: ITEM_GLOVE, item_code: 'STK000010', item_name: 'İş eldiveni' }
const main = { warehouse_id: WH_MAIN, warehouse_code: 'MRK', warehouse_name: 'Merkez depo' }
const shop = { warehouse_id: WH_SHOP, warehouse_code: 'MGZ', warehouse_name: 'Mağaza' }

function movement(over: Partial<StockMovement> & Pick<StockMovement, 'id' | 'seq'>): StockMovement {
  const row: StockMovement = {
    ...bolt,
    warehouse_id: WH_MAIN,
    location_id: null,
    lot_id: null,
    lot_no: null,
    serial_id: null,
    serial_no: null,
    movement_type: 'receipt',
    direction: 'in',
    quantity: '10.000000',
    signed_quantity: '10.000000',
    unit_cost: '2.500000',
    total_cost: '25.0000',
    occurred_at: '2026-10-01',
    document_type: 'stock_document',
    document_id: DOC_RECEIPT,
    document_number: 'GRS-2026-000001',
    document_doc_type: 'receipt',
    document_line_id: null,
    journal_entry_id: JE_RECEIPT,
    reverses_id: null,
    created_by: null,
    created_at: null,
    ...over,
  }
  row.signed_quantity = row.direction === 'out' ? `-${row.quantity}` : row.quantity
  return row
}

function balance(over: Partial<StockBalance>): StockBalance {
  return {
    ...bolt,
    base_unit_id: 'unit-pcs',
    ...main,
    location_id: null,
    location_code: null,
    lot_id: null,
    lot_no: null,
    expiry_date: null,
    on_hand: '0.000000',
    reserved: '0.000000',
    available: '0.000000',
    avg_cost: '0.000000',
    value: '0.0000',
    ...over,
  }
}

export function createInventoryStockDb(
  overrides: Partial<InventoryStockDb> = {},
): InventoryStockDb {
  const now = today()
  const oldLot = { lot_id: LOT_OLD, lot_no: 'L-2401', expiry_date: addDays(now, -3) }
  const newLot = { lot_id: LOT_NEW, lot_no: 'L-2402', expiry_date: addDays(now, 10) }
  const oldLotRef = { lot_id: LOT_OLD, lot_no: oldLot.lot_no }
  const newLotRef = { lot_id: LOT_NEW, lot_no: newLot.lot_no }
  const movements: StockMovement[] = [
    movement({ id: 'mv-1', seq: 1, ...oldLotRef, occurred_at: '2026-09-01' }),
    movement({
      id: 'mv-2',
      seq: 2,
      ...newLotRef,
      location_id: 'loc-a01',
      quantity: '1250.500000',
      total_cost: '3126.2500',
      occurred_at: '2026-09-15',
    }),
    movement({
      id: 'mv-3',
      seq: 3,
      movement_type: 'issue',
      direction: 'out',
      ...oldLotRef,
      quantity: '4.000000',
      total_cost: '10.0000',
      document_number: 'CKS-2026-000001',
      document_doc_type: 'issue',
      document_id: 'doc-issue-1',
      journal_entry_id: 'je-issue-1',
      occurred_at: '2026-10-02',
    }),
    movement({
      id: 'mv-4',
      seq: 4,
      ...glove,
      warehouse_id: WH_SHOP,
      movement_type: 'transfer_in',
      quantity: '20.000000',
      unit_cost: '7.250000',
      total_cost: '145.0000',
      document_number: 'TRF-2026-000001',
      document_doc_type: 'transfer',
      document_id: 'doc-transfer-1',
      journal_entry_id: null,
      occurred_at: '2026-10-05',
    }),
  ]
  const balances: StockBalance[] = [
    balance({
      ...oldLot,
      on_hand: '6.000000',
      available: '6.000000',
      avg_cost: '2.500000',
      value: '15.0000',
    }),
    balance({
      ...newLot,
      location_id: 'loc-a01',
      location_code: 'A-01',
      on_hand: '1250.500000',
      reserved: '200.000000',
      available: '1050.500000',
      avg_cost: '2.500000',
      value: '3126.2500',
    }),
    balance({
      ...glove,
      ...shop,
      on_hand: '-2.000000',
      available: '-2.000000',
      avg_cost: '7.250000',
      value: '-14.5000',
    }),
    balance({ ...glove, ...main, avg_cost: '7.000000' }),
  ]
  const lot = (over: Partial<StockLot> & Pick<StockLot, 'id' | 'lot_no'>): StockLot => ({
    ...bolt,
    expiry_date: null,
    manufacture_date: null,
    on_hand: '0.000000',
    is_expired: over.expiry_date ? over.expiry_date < now : false,
    created_at: null,
    ...over,
  })
  return {
    warehouses: [
      warehouse({ id: WH_MAIN, code: 'MRK', name: 'Merkez depo', is_default: true }),
      warehouse({
        id: WH_SHOP,
        code: 'MGZ',
        name: 'Mağaza',
        negative_stock_policy: 'allow',
        allow_negative_stock: true,
        reservation_policy: 'hard',
      }),
      warehouse({ id: 'wh-old', code: 'ESK', name: 'Eski depo', is_active: false }),
    ],
    movedWarehouses: [WH_MAIN, WH_SHOP],
    locations: [
      {
        id: 'loc-a',
        warehouse_id: WH_MAIN,
        code: 'A',
        name: 'Koridor A',
        is_active: true,
        parent_id: null,
        type: 'aisle',
        barcode: null,
        version: 1,
      },
      {
        id: 'loc-a01',
        warehouse_id: WH_MAIN,
        code: 'A-01',
        name: 'Raf A-01',
        is_active: true,
        parent_id: 'loc-a',
        type: 'rack',
        barcode: null,
        version: 1,
      },
      {
        id: 'loc-a0103',
        warehouse_id: WH_MAIN,
        code: 'A-01-03',
        name: 'Göz 3',
        is_active: true,
        parent_id: 'loc-a01',
        type: 'bin',
        barcode: '8690000000013',
        version: 1,
      },
      {
        id: 'loc-b',
        warehouse_id: WH_MAIN,
        code: 'B',
        name: 'Koridor B',
        is_active: false,
        parent_id: null,
        type: 'aisle',
        barcode: null,
        version: 1,
      },
    ],
    balances,
    itemStock: {
      [ITEM_BOLT]: {
        ...bolt,
        base_unit_id: 'unit-pcs',
        on_hand: '1256.500000',
        reserved: '200.000000',
        available: '1056.500000',
        avg_cost: '2.500000',
        value: '3141.2500',
        warehouses: [
          {
            ...main,
            on_hand: '1256.500000',
            reserved: '200.000000',
            available: '1056.500000',
            avg_cost: '2.500000',
            value: '3141.2500',
          },
        ],
        lots: [
          { ...oldLot, on_hand: '6.000000', reserved: '0.000000', available: '6.000000' },
          { ...newLot, on_hand: '1250.500000', reserved: '200.000000', available: '1050.500000' },
        ],
      },
    },
    movements,
    lots: [
      lot({
        id: LOT_OLD,
        lot_no: oldLot.lot_no,
        expiry_date: oldLot.expiry_date,
        manufacture_date: '2026-01-10',
        created_at: '2026-09-01T08:00:00Z',
        on_hand: '6.000000',
      }),
      lot({
        id: LOT_NEW,
        lot_no: newLot.lot_no,
        expiry_date: newLot.expiry_date,
        created_at: '2026-09-15T08:00:00Z',
        on_hand: '1250.500000',
      }),
    ],
    serials: [
      {
        id: 'sn-1',
        item_id: 'item-drill',
        item_code: 'STK000020',
        item_name: 'Matkap',
        serial_no: 'MTK-0001',
        lot_id: null,
        lot_no: null,
        status: 'in_stock',
        warehouse_id: WH_MAIN,
        location_id: 'loc-a01',
        created_at: null,
        updated_at: null,
      },
      {
        id: 'sn-2',
        item_id: 'item-drill',
        item_code: 'STK000020',
        item_name: 'Matkap',
        serial_no: 'MTK-0002',
        lot_id: null,
        lot_no: null,
        status: 'issued',
        warehouse_id: null,
        location_id: null,
        created_at: null,
        updated_at: null,
      },
    ],
    calls: [],
    ...overrides,
  }
}

const MAX_PER_PAGE = 100

function paginate<T>(rows: T[], url: URL) {
  const page = Number(url.searchParams.get('page') ?? 1)
  const perPage = Number(url.searchParams.get('per_page') ?? 25)
  const total = rows.length
  return {
    data: rows.slice((page - 1) * perPage, page * perPage),
    meta: {
      pagination: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    },
  }
}

const filterOf = (url: URL, key: string) => url.searchParams.get(`filter[${key}]`) ?? ''
const isTrue = (v: string) => v === '1' || v === 'true'
const BOOL_VALUES = ['', '0', '1', 'true', 'false']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

type FilterType = 'id' | 'date' | 'bool' | 'string'

/** InventoryController::filters: unknown filter -> 422 filter.x; values typed per filter. */
function guardFilters(url: URL, allowed: Record<string, FilterType>) {
  for (const [key, value] of url.searchParams) {
    const name = /^filter\[(.+)\]$/.exec(key)?.[1]
    if (name === undefined) continue
    const type = allowed[name]
    if (!type) return validation({ [`filter.${name}`]: ['Seçili filtre geçersiz.'] })
    if (type === 'date' && value !== '' && !ISO_DATE.test(value))
      return validation({ [name]: ['Tarih YYYY-AA-GG olmalı.'] })
    if (type === 'bool' && !BOOL_VALUES.includes(value))
      return validation({ [name]: ['Seçili değer geçersiz.'] })
  }
  return null
}

/** InventoryController::page: per_page 1..100. */
function guardPage(url: URL) {
  const perPage = url.searchParams.get('per_page')
  if (perPage !== null && (Number(perPage) < 1 || Number(perPage) > MAX_PER_PAGE))
    return validation({ per_page: [`En çok ${MAX_PER_PAGE} olabilir.`] })
  return null
}

/** InventoryController::sort: every key must be allowed (422 sort), default when absent. */
function sortRows<T>(
  rows: T[],
  url: URL,
  pick: Record<string, (row: T) => string | number>,
  fallback: string,
): T[] | Response {
  const raw = url.searchParams.get('sort')
  const sort = raw === null || raw === '' ? fallback : raw
  const parts = sort.split(',')
  for (const part of parts) {
    if (!pick[part.replace(/^-/, '')]) return validation({ sort: ['Sıralama alanı geçersiz.'] })
  }
  return rows.slice().sort((a, b) => {
    for (const part of parts) {
      const desc = part.startsWith('-')
      const get = pick[part.replace(/^-/, '')]
      if (!get) continue
      const x = get(a)
      const y = get(b)
      const r =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x).localeCompare(String(y), 'tr', { numeric: true })
      if (r !== 0) return desc ? -r : r
    }
    return 0
  })
}

const exportResponse = (name: string, url: URL) => {
  const format = url.searchParams.get('format') ?? 'csv'
  if (!['csv', 'xlsx'].includes(format)) return validation({ format: ['Biçim geçersiz.'] })
  return new HttpResponse(`item_code;on_hand\n`, {
    headers: {
      'Content-Type': format === 'xlsx' ? 'application/octet-stream' : 'text/csv',
      'Content-Disposition': `attachment; filename="${name}.${format}"`,
    },
  })
}

const add = (a: string, b: string, scale: number) => new Decimal(a).plus(b).toFixed(scale)

/** Groups the finest balance rows like StockBalanceController (warehouse | item | detail). */
function groupBalances(rows: StockBalance[], group: string): StockBalance[] {
  if (group === 'detail') return rows
  const merged = new Map<string, StockBalance>()
  for (const b of rows) {
    const key = group === 'item' ? b.item_id : `${b.item_id}:${b.warehouse_id}`
    const prev = merged.get(key)
    const base = {
      location_id: null,
      location_code: null,
      lot_id: null,
      lot_no: null,
      expiry_date: null,
    }
    if (!prev) {
      merged.set(key, {
        ...b,
        ...base,
        ...(group === 'item'
          ? { warehouse_id: '', warehouse_code: null, warehouse_name: null }
          : {}),
      })
      continue
    }
    prev.on_hand = add(prev.on_hand, b.on_hand, 6)
    prev.reserved = add(prev.reserved, b.reserved, 6)
    prev.available = add(prev.available, b.available, 6)
    prev.value = add(prev.value, b.value, 4)
  }
  return [...merged.values()]
}

export function inventoryStockHandlers(db: InventoryStockDb) {
  const record = http.all(`${API}/*`, async ({ request }) => {
    const url = new URL(request.url)
    let body: unknown = null
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      body = await request
        .clone()
        .json()
        .catch(() => null)
    }
    db.calls.push({
      method: request.method,
      path: url.pathname.replace(/^.*\/api\/v1/, ''),
      body,
      headers: request.headers,
      url,
    })
    return undefined
  })

  const movementsMatching = (url: URL) =>
    db.movements.filter(
      (m) =>
        (!filterOf(url, 'item_id') || m.item_id === filterOf(url, 'item_id')) &&
        (!filterOf(url, 'warehouse_id') || m.warehouse_id === filterOf(url, 'warehouse_id')) &&
        (!filterOf(url, 'location_id') || m.location_id === filterOf(url, 'location_id')) &&
        (!filterOf(url, 'movement_type') || m.movement_type === filterOf(url, 'movement_type')) &&
        (!filterOf(url, 'direction') || m.direction === filterOf(url, 'direction')) &&
        (!filterOf(url, 'lot_id') || m.lot_id === filterOf(url, 'lot_id')) &&
        (!filterOf(url, 'serial_id') || m.serial_id === filterOf(url, 'serial_id')) &&
        (!filterOf(url, 'document_id') || m.document_id === filterOf(url, 'document_id')) &&
        (!filterOf(url, 'date_from') || m.occurred_at >= filterOf(url, 'date_from')) &&
        (!filterOf(url, 'date_to') || m.occurred_at <= filterOf(url, 'date_to')),
    )

  const MOVEMENT_FILTERS: Record<string, FilterType> = {
    item_id: 'id',
    warehouse_id: 'id',
    location_id: 'id',
    lot_id: 'id',
    serial_id: 'id',
    document_id: 'id',
    movement_type: 'string',
    direction: 'string',
    date_from: 'date',
    date_to: 'date',
  }

  const BALANCE_FILTERS: Record<string, FilterType> = {
    item_id: 'id',
    warehouse_id: 'id',
    location_id: 'id',
    lot_id: 'id',
    category_id: 'id',
    include_zero: 'bool',
  }

  const balancesMatching = (url: URL): StockBalance[] | Response => {
    const refused = guardFilters(url, BALANCE_FILTERS)
    if (refused) return refused
    const group = url.searchParams.get('group_by') ?? 'warehouse'
    if (!['warehouse', 'item', 'detail'].includes(group))
      return validation({ group_by: ['Seçili değer geçersiz.'] })
    const q = (url.searchParams.get('q') ?? '').toLocaleLowerCase('tr')
    const rows = db.balances.filter(
      (b) =>
        (!q || `${b.item_code} ${b.item_name}`.toLocaleLowerCase('tr').includes(q)) &&
        (['item_id', 'warehouse_id', 'location_id', 'lot_id'] as const).every(
          (k) => !filterOf(url, k) || b[k] === filterOf(url, k),
        ),
    )
    const grouped = groupBalances(rows, group).filter(
      (b) =>
        isTrue(filterOf(url, 'include_zero')) ||
        !new Decimal(b.on_hand).isZero() ||
        !new Decimal(b.reserved).isZero(),
    )
    return sortRows(
      grouped,
      url,
      {
        item_code: (b) => b.item_code,
        warehouse_code: (b) => b.warehouse_code ?? '',
        on_hand: (b) => Number(b.on_hand),
        reserved: (b) => Number(b.reserved),
        available: (b) => Number(b.available),
        value: (b) => Number(b.value),
      },
      group === 'item' ? 'item_code' : 'item_code,warehouse_code',
    )
  }

  const lotTrace = (id: string) => {
    const lot = db.lots.find((l) => l.id === id)
    if (!lot) return null
    const movements = db.movements.filter((m) => m.lot_id === id).sort((a, b) => a.seq - b.seq)
    const totals = new Map<string, { in: Decimal; out: Decimal }>()
    for (const m of movements) {
      const t = totals.get(m.warehouse_id) ?? { in: new Decimal(0), out: new Decimal(0) }
      if (m.direction === 'in') t.in = t.in.plus(m.quantity)
      else t.out = t.out.plus(m.quantity)
      totals.set(m.warehouse_id, t)
    }
    return {
      lot,
      summary: [...totals.entries()].map(([warehouseId, t]) => ({
        warehouse_id: warehouseId,
        received: t.in.toFixed(6),
        issued: t.out.toFixed(6),
        on_hand: t.in.minus(t.out).toFixed(6),
      })),
      movements,
    }
  }

  return [
    record,
    // --- Warehouses (Inventory policy) and Reference locations ------------------------------
    http.get(`${API}/stock-warehouses`, () =>
      HttpResponse.json({
        data: db.warehouses.slice().sort((a, b) => a.code.localeCompare(b.code)),
      }),
    ),
    http.get(`${API}/stock-warehouses/:id`, ({ params }) => {
      const w = db.warehouses.find((x) => x.id === params.id)
      if (!w) return notFound()
      return HttpResponse.json({
        data: { ...w, has_movements: db.movedWarehouses.includes(w.id) },
      })
    }),
    http.patch(`${API}/stock-warehouses/:id`, async ({ params, request }) => {
      const w = db.warehouses.find((x) => x.id === params.id)
      if (!w) return notFound()
      const body = (await request.json()) as { reservation_policy?: string; version?: number }
      const fields: Record<string, string[]> = {}
      if (!['none', 'soft', 'hard'].includes(body.reservation_policy ?? ''))
        fields.reservation_policy = ['Seçili değer geçersiz.']
      if (typeof body.version !== 'number' || body.version < 1)
        fields.version = ['Sürüm zorunludur.']
      if (Object.keys(fields).length) return validation(fields)
      if (body.version !== w.version) return conflict()
      w.reservation_policy = body.reservation_policy as StockWarehouse['reservation_policy']
      w.version += 1
      return HttpResponse.json({ data: w })
    }),
    http.get(`${API}/warehouses/:id/locations`, ({ params, request }) => {
      const url = new URL(request.url)
      const refused = guardPage(url)
      if (refused) return refused
      const rows = db.locations
        .filter((l) => l.warehouse_id === params.id)
        .sort((a, b) => a.code.localeCompare(b.code, 'tr', { numeric: true }))
      return HttpResponse.json(paginate(rows, url))
    }),

    // --- Balances -----------------------------------------------------------------------------
    http.get(`${API}/stock-balances/export`, ({ request }) => {
      const url = new URL(request.url)
      const rows = balancesMatching(url)
      return rows instanceof Response ? rows : exportResponse('stock-balances', url)
    }),
    http.get(`${API}/stock-balances`, ({ request }) => {
      const url = new URL(request.url)
      const refused = guardPage(url)
      if (refused) return refused
      const rows = balancesMatching(url)
      return rows instanceof Response ? rows : HttpResponse.json(paginate(rows, url))
    }),
    http.get(`${API}/items/:id/stock`, ({ params }) => {
      const stock = db.itemStock[String(params.id)]
      return stock ? HttpResponse.json({ data: stock }) : notFound()
    }),

    // --- Movements ----------------------------------------------------------------------------
    http.get(`${API}/stock-movements/export`, ({ request }) => {
      const url = new URL(request.url)
      const refused = guardFilters(url, MOVEMENT_FILTERS)
      return refused ?? exportResponse('stock-movements', url)
    }),
    http.get(`${API}/stock-movements`, ({ request }) => {
      const url = new URL(request.url)
      const cursor = url.searchParams.get('cursor')
      const perPageRaw = url.searchParams.get('per_page')
      const order = url.searchParams.get('order') ?? 'desc'
      if (cursor !== null && !/^\d+$/.test(cursor))
        return validation({ cursor: ['Tam sayı olmalı.'] })
      if (perPageRaw !== null && (Number(perPageRaw) < 1 || Number(perPageRaw) > 200))
        return validation({ per_page: ['En çok 200 olabilir.'] })
      if (!['asc', 'desc'].includes(order)) return validation({ order: ['Geçersiz.'] })
      const refused = guardFilters(url, MOVEMENT_FILTERS)
      if (refused) return refused
      const perPage = perPageRaw === null ? 50 : Number(perPageRaw)
      const asc = order === 'asc'
      let rows = movementsMatching(url).sort((a, b) => (asc ? a.seq - b.seq : b.seq - a.seq))
      if (cursor !== null) rows = rows.filter((m) => (asc ? m.seq > +cursor : m.seq < +cursor))
      const page = rows.slice(0, perPage)
      const last = page.at(-1)
      return HttpResponse.json({
        data: page,
        meta: { per_page: perPage, next_cursor: rows.length > perPage && last ? last.seq : null },
      })
    }),

    // --- Lots and serials ---------------------------------------------------------------------
    http.get(`${API}/stock-lots`, ({ request }) => {
      const url = new URL(request.url)
      const refused =
        guardFilters(url, {
          item_id: 'id',
          expires_before: 'date',
          expired: 'bool',
          with_stock: 'bool',
        }) ?? guardPage(url)
      if (refused) return refused
      const now = today()
      const q = (url.searchParams.get('q') ?? '').toLocaleLowerCase('tr')
      const before = filterOf(url, 'expires_before')
      const rows = db.lots.filter(
        (l) =>
          (!q || l.lot_no.toLocaleLowerCase('tr').includes(q)) &&
          (!filterOf(url, 'item_id') || l.item_id === filterOf(url, 'item_id')) &&
          (!before || (l.expiry_date !== null && l.expiry_date <= before)) &&
          (!isTrue(filterOf(url, 'expired')) || (l.expiry_date !== null && l.expiry_date < now)) &&
          (!isTrue(filterOf(url, 'with_stock')) || new Decimal(l.on_hand).greaterThan(0)),
      )
      const sorted = sortRows(
        rows,
        url,
        {
          expiry_date: (l) => l.expiry_date ?? '9999',
          lot_no: (l) => l.lot_no,
          created_at: (l) => l.created_at ?? '',
          on_hand: (l) => Number(l.on_hand),
        },
        'expiry_date,lot_no',
      )
      return sorted instanceof Response ? sorted : HttpResponse.json(paginate(sorted, url))
    }),
    http.get(`${API}/stock-lots/:id/trace`, ({ params }) => {
      const trace = lotTrace(String(params.id))
      return trace ? HttpResponse.json({ data: trace }) : notFound()
    }),
    http.get(`${API}/stock-lots/:id`, ({ params }) => {
      const lot = db.lots.find((l) => l.id === params.id)
      return lot ? HttpResponse.json({ data: lot }) : notFound()
    }),
    http.get(`${API}/stock-serials`, ({ request }) => {
      const url = new URL(request.url)
      const refused =
        guardFilters(url, { item_id: 'id', status: 'string', warehouse_id: 'id' }) ?? guardPage(url)
      if (refused) return refused
      const q = (url.searchParams.get('q') ?? '').toLocaleLowerCase('tr')
      const rows = db.serials.filter(
        (s) =>
          (!q || s.serial_no.toLocaleLowerCase('tr').includes(q)) &&
          (!filterOf(url, 'status') || s.status === filterOf(url, 'status')) &&
          (!filterOf(url, 'item_id') || s.item_id === filterOf(url, 'item_id')) &&
          (!filterOf(url, 'warehouse_id') || s.warehouse_id === filterOf(url, 'warehouse_id')),
      )
      const sorted = sortRows(
        rows,
        url,
        {
          serial_no: (s) => s.serial_no,
          status: (s) => s.status,
          created_at: (s) => s.created_at ?? '',
        },
        'serial_no',
      )
      return sorted instanceof Response ? sorted : HttpResponse.json(paginate(sorted, url))
    }),
  ]
}
