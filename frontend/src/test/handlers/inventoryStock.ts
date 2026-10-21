import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import type {
  ItemStock,
  LotTrace,
  StockBalance,
  StockLot,
  StockMovement,
  StockSerial,
  Warehouse,
  WarehouseLocation,
} from '@/features/inventory/stock/lib/types'
import { addDays, toIsoDate } from '@/lib/datetime'
import { ITEM_BOLT } from './catalog'

// In-memory stand-in for the Inventory API used by the warehouse, stock status, movement and
// lot/serial screens (PHASE4 "HTTP API"). Shapes are the ones assumed in
// features/inventory/stock/lib/types.ts until the backend lane lands.

export interface InventoryStockDb {
  warehouses: Warehouse[]
  locations: WarehouseLocation[]
  balances: StockBalance[]
  itemStock: Record<string, ItemStock>
  movements: StockMovement[]
  lots: StockLot[]
  traces: Record<string, LotTrace>
  serials: StockSerial[]
  /** Replayed responses per Idempotency-Key. */
  replays: Map<string, { status: number; body: unknown }>
  calls: { method: string; path: string; body: unknown; headers: Headers; url: URL }[]
  seq: number
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

function warehouse(over: Partial<Warehouse> & Pick<Warehouse, 'id' | 'code' | 'name'>): Warehouse {
  return {
    address: null,
    is_active: true,
    is_default: false,
    allow_negative_stock: false,
    reservation_policy: 'soft',
    version: 1,
    locations_count: 0,
    has_movements: false,
    ...over,
  }
}

const bolt = { id: ITEM_BOLT, code: 'STK000001', name: 'Cıvata M8', tracking: 'lot' as const }
const glove = { id: ITEM_GLOVE, code: 'STK000010', name: 'İş eldiveni', tracking: 'none' as const }
const main = { id: WH_MAIN, code: 'MRK', name: 'Merkez depo' }
const shop = { id: WH_SHOP, code: 'MGZ', name: 'Mağaza' }

function movement(over: Partial<StockMovement> & Pick<StockMovement, 'id' | 'seq'>): StockMovement {
  return {
    item_id: ITEM_BOLT,
    item: bolt,
    warehouse_id: WH_MAIN,
    warehouse: main,
    location: null,
    lot: null,
    serial: null,
    movement_type: 'receipt',
    direction: 'in',
    quantity: '10.000000',
    unit_cost: '2.500000',
    total_cost: '25.0000',
    occurred_at: '2026-10-01T09:00:00Z',
    document_type: 'stock_document',
    document_id: DOC_RECEIPT,
    document_number: 'GRS-2026-000001',
    document_line_id: null,
    journal_entry_id: JE_RECEIPT,
    reverses_id: null,
    created_by: null,
    ...over,
  }
}

export function createInventoryStockDb(
  overrides: Partial<InventoryStockDb> = {},
): InventoryStockDb {
  const now = today()
  const oldLot = { id: LOT_OLD, lot_no: 'L-2401', expiry_date: addDays(now, -3) }
  const newLot = { id: LOT_NEW, lot_no: 'L-2402', expiry_date: addDays(now, 10) }
  const movements: StockMovement[] = [
    movement({ id: 'mv-1', seq: 1, lot: oldLot, occurred_at: '2026-09-01T08:00:00Z' }),
    movement({
      id: 'mv-2',
      seq: 2,
      lot: newLot,
      quantity: '1250.500000',
      total_cost: '3126.2500',
      occurred_at: '2026-09-15T08:00:00Z',
    }),
    movement({
      id: 'mv-3',
      seq: 3,
      movement_type: 'issue',
      direction: 'out',
      lot: oldLot,
      quantity: '4.000000',
      total_cost: '10.0000',
      document_number: 'CKS-2026-000001',
      document_id: 'doc-issue-1',
      journal_entry_id: 'je-issue-1',
      occurred_at: '2026-10-02T08:00:00Z',
    }),
    movement({
      id: 'mv-4',
      seq: 4,
      item_id: ITEM_GLOVE,
      item: glove,
      warehouse_id: WH_SHOP,
      warehouse: shop,
      movement_type: 'transfer_in',
      quantity: '20.000000',
      unit_cost: '7.250000',
      total_cost: '145.0000',
      document_number: 'TRF-2026-000001',
      document_id: 'doc-transfer-1',
      journal_entry_id: null,
      occurred_at: '2026-10-05T08:00:00Z',
    }),
  ]
  const balances: StockBalance[] = [
    {
      item_id: ITEM_BOLT,
      item: bolt,
      warehouse_id: WH_MAIN,
      warehouse: main,
      location_id: null,
      location: null,
      lot_id: LOT_OLD,
      lot: oldLot,
      on_hand: '6.000000',
      reserved: '0.000000',
      available: '6.000000',
      avg_cost: '2.500000',
      value: '15.0000',
      reorder_point: '50.000000',
    },
    {
      item_id: ITEM_BOLT,
      item: bolt,
      warehouse_id: WH_MAIN,
      warehouse: main,
      location_id: 'loc-a01',
      location: { id: 'loc-a01', code: 'A-01', name: 'Raf A-01' },
      lot_id: LOT_NEW,
      lot: newLot,
      on_hand: '1250.500000',
      reserved: '200.000000',
      available: '1050.500000',
      avg_cost: '2.500000',
      value: '3126.2500',
      reorder_point: '50.000000',
    },
    {
      item_id: ITEM_GLOVE,
      item: glove,
      warehouse_id: WH_SHOP,
      warehouse: shop,
      location_id: null,
      location: null,
      lot_id: null,
      lot: null,
      on_hand: '-2.000000',
      reserved: '0.000000',
      available: '-2.000000',
      avg_cost: '7.250000',
      value: '-14.5000',
      reorder_point: '5.000000',
    },
  ]
  const oldLotRow: StockLot = {
    ...oldLot,
    item_id: ITEM_BOLT,
    item: bolt,
    manufacture_date: '2026-01-10',
    created_at: '2026-09-01T08:00:00Z',
    on_hand: '6.000000',
  }
  const lots: StockLot[] = [
    oldLotRow,
    {
      ...newLot,
      item_id: ITEM_BOLT,
      item: bolt,
      manufacture_date: null,
      created_at: '2026-09-15T08:00:00Z',
      on_hand: '1250.500000',
    },
  ]
  return {
    warehouses: [
      warehouse({
        ...main,
        is_default: true,
        address: 'Organize Sanayi Bölgesi, Kocaeli',
        locations_count: 4,
        has_movements: true,
      }),
      warehouse({ ...shop, allow_negative_stock: true, reservation_policy: 'hard' }),
      warehouse({ id: 'wh-old', code: 'ESK', name: 'Eski depo', is_active: false }),
    ],
    locations: [
      { id: 'loc-a', warehouse_id: WH_MAIN, code: 'A', name: 'Koridor A', is_active: true },
      { id: 'loc-a01', warehouse_id: WH_MAIN, code: 'A-01', name: 'Raf A-01', is_active: true },
      {
        id: 'loc-a0103',
        warehouse_id: WH_MAIN,
        code: 'A-01-03',
        name: 'Göz 3',
        is_active: true,
      },
      { id: 'loc-b', warehouse_id: WH_MAIN, code: 'B', name: 'Koridor B', is_active: false },
    ],
    balances,
    itemStock: {
      [ITEM_BOLT]: {
        item: { ...bolt, base_unit_code: 'ADET', reorder_point: '50.000000', min_stock: null },
        totals: {
          on_hand: '1256.500000',
          reserved: '200.000000',
          available: '1056.500000',
          avg_cost: '2.500000',
          value: '3141.2500',
        },
        warehouses: [
          {
            warehouse: main,
            on_hand: '1256.500000',
            reserved: '200.000000',
            available: '1056.500000',
            avg_cost: '2.500000',
            value: '3141.2500',
          },
        ],
        lots: [
          { lot: oldLot, warehouse: main, on_hand: '6.000000' },
          { lot: newLot, warehouse: main, on_hand: '1250.500000' },
        ],
      },
    },
    movements,
    lots,
    traces: {
      [LOT_OLD]: {
        lot: oldLotRow,
        received: '10.000000',
        issued: '4.000000',
        balances: [{ warehouse: main, location: null, on_hand: '6.000000' }],
        movements: movements.filter((m) => m.lot?.id === LOT_OLD),
      },
    },
    serials: [
      {
        id: 'sn-1',
        item_id: 'item-drill',
        item: { id: 'item-drill', code: 'STK000020', name: 'Matkap', tracking: 'serial' },
        serial_no: 'MTK-0001',
        lot_id: null,
        lot: null,
        status: 'in_stock',
        warehouse: main,
        location: { id: 'loc-a01', code: 'A-01', name: 'Raf A-01' },
      },
      {
        id: 'sn-2',
        item_id: 'item-drill',
        item: { id: 'item-drill', code: 'STK000020', name: 'Matkap', tracking: 'serial' },
        serial_no: 'MTK-0002',
        lot_id: null,
        lot: null,
        status: 'issued',
        warehouse: null,
        location: null,
      },
    ],
    replays: new Map(),
    calls: [],
    seq: 100,
    ...overrides,
  }
}

function paginate<T>(rows: T[], url: URL) {
  const page = Number(url.searchParams.get('page') ?? 1)
  const perPage = Number(url.searchParams.get('per_page') ?? 25)
  const total = rows.length
  return {
    data: rows.slice((page - 1) * perPage, page * perPage),
    pagination: {
      current_page: page,
      per_page: perPage,
      total,
      last_page: Math.max(1, Math.ceil(total / perPage)),
    },
  }
}

const filterOf = (url: URL, key: string) => url.searchParams.get(`filter[${key}]`) ?? ''

/** Only the listed filters exist; anything else is a 422 as Core ListQuery does. */
function guard(url: URL, filters: readonly string[]) {
  for (const [key] of url.searchParams) {
    const m = /^filter\[(.+)\]$/.exec(key)
    if (m && !filters.includes(m[1] ?? ''))
      return validation({ [`filter.${m[1]}`]: ['Seçili değer geçersiz.'] })
  }
  if (Number(url.searchParams.get('per_page') ?? 25) > 100)
    return validation({ per_page: ['En çok 100 olabilir.'] })
  return null
}

function sortBy<T>(rows: T[], url: URL, pick: Record<string, (row: T) => string>) {
  const sort = url.searchParams.get('sort')
  if (!sort) return rows
  const [first] = sort.split(',')
  const desc = first?.startsWith('-') ?? false
  const key = first?.replace(/^-/, '') ?? ''
  const get = pick[key]
  if (!get) return rows
  return rows.slice().sort((a, b) => {
    const r = get(a).localeCompare(get(b), 'tr', { numeric: true })
    return desc ? -r : r
  })
}

const exportResponse = (name: string, url: URL) =>
  new HttpResponse(`kod;ad\n`, {
    headers: {
      'Content-Type':
        url.searchParams.get('format') === 'xlsx' ? 'application/octet-stream' : 'text/csv',
      'Content-Disposition': `attachment; filename="${name}.${url.searchParams.get('format') ?? 'csv'}"`,
    },
  })

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

  const idempotent = async (
    request: Request,
    create: () => Promise<{ status: number; body: unknown }>,
  ) => {
    const key = request.headers.get('Idempotency-Key')
    if (!key) return error(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key gerekli.')
    const hit = db.replays.get(key)
    if (hit) return HttpResponse.json(hit.body as object, { status: hit.status })
    const res = await create()
    if (res.status < 300) db.replays.set(key, res)
    return HttpResponse.json(res.body as object, { status: res.status })
  }

  type WarehouseBody = Partial<Warehouse> & { version?: number }

  const validateWarehouse = (body: WarehouseBody, id: string | null) => {
    const fields: Record<string, string[]> = {}
    if (!body.code?.trim()) fields.code = ['Kod zorunludur.']
    else if (db.warehouses.some((w) => w.code === body.code && w.id !== id))
      fields.code = ['Bu kod zaten kullanılıyor.']
    if (!body.name?.trim()) fields.name = ['Ad zorunludur.']
    return Object.keys(fields).length ? fields : null
  }

  const makeDefault = (id: string) => {
    for (const w of db.warehouses) {
      if (w.id !== id && w.is_default) {
        w.is_default = false
        w.version += 1
      }
    }
  }

  return [
    record,
    // --- Warehouses ---------------------------------------------------------------------------
    http.get(`${API}/warehouses/export`, ({ request }) =>
      exportResponse('depolar', new URL(request.url)),
    ),
    http.get(`${API}/warehouses`, ({ request }) => {
      const url = new URL(request.url)
      const refused = guard(url, ['is_active', 'reservation_policy'])
      if (refused) return refused
      const q = (url.searchParams.get('q') ?? '').toLocaleLowerCase('tr')
      let rows = db.warehouses.filter(
        (w) =>
          (!q || `${w.code} ${w.name}`.toLocaleLowerCase('tr').includes(q)) &&
          (!filterOf(url, 'is_active') || String(w.is_active) === filterOf(url, 'is_active')) &&
          (!filterOf(url, 'reservation_policy') ||
            w.reservation_policy === filterOf(url, 'reservation_policy')),
      )
      rows = sortBy(rows, url, { code: (w) => w.code, name: (w) => w.name })
      const { data, pagination } = paginate(rows, url)
      return HttpResponse.json({ data, meta: { pagination } })
    }),
    http.get(`${API}/warehouses/:id`, ({ params }) => {
      const w = db.warehouses.find((x) => x.id === params.id)
      return w ? HttpResponse.json({ data: w }) : notFound()
    }),
    http.post(`${API}/warehouses`, async ({ request }) => {
      const body = (await request.json()) as WarehouseBody
      return idempotent(request, () => {
        const fields = validateWarehouse(body, null)
        if (fields) {
          return Promise.resolve({
            status: 422,
            body: {
              errors: { message: Object.values(fields)[0]?.[0], code: 'VALIDATION_ERROR', fields },
            },
          })
        }
        db.seq += 1
        const created = warehouse({
          id: `wh-${db.seq}`,
          code: body.code ?? '',
          name: body.name ?? '',
          address: body.address ?? null,
          is_active: body.is_active ?? true,
          is_default: body.is_default ?? false,
          allow_negative_stock: body.allow_negative_stock ?? false,
          reservation_policy: body.reservation_policy ?? 'soft',
        })
        if (created.is_default) makeDefault(created.id)
        db.warehouses.push(created)
        return Promise.resolve({ status: 201, body: { data: created } })
      })
    }),
    http.patch(`${API}/warehouses/:id`, async ({ params, request }) => {
      const w = db.warehouses.find((x) => x.id === params.id)
      if (!w) return notFound()
      const body = (await request.json()) as WarehouseBody
      if (body.version !== w.version) return conflict()
      const fields = validateWarehouse({ ...w, ...body }, w.id)
      if (fields) return validation(fields)
      if (w.is_default && body.is_default === false)
        return validation({ is_default: ['Şirketin bir varsayılan deposu olmalı.'] })
      Object.assign(w, body, { version: w.version + 1 })
      if (w.is_default) makeDefault(w.id)
      return HttpResponse.json({ data: w })
    }),
    http.delete(`${API}/warehouses/:id`, ({ params, request }) => {
      const w = db.warehouses.find((x) => x.id === params.id)
      if (!w) return notFound()
      const version = Number(new URL(request.url).searchParams.get('version'))
      if (version !== w.version) return conflict()
      if (w.has_movements || w.is_default)
        return error(422, 'WAREHOUSE_IN_USE', 'Hareket görmüş depo silinemez.')
      db.warehouses = db.warehouses.filter((x) => x.id !== w.id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.get(`${API}/warehouses/:id/locations`, ({ params, request }) => {
      const url = new URL(request.url)
      const rows = db.locations.filter((l) => l.warehouse_id === params.id)
      const { data, pagination } = paginate(rows, url)
      return HttpResponse.json({ data, meta: { pagination } })
    }),
    http.post(`${API}/warehouses/:id/locations`, async ({ params, request }) => {
      const body = (await request.json()) as Partial<WarehouseLocation>
      const warehouseId = String(params.id)
      return idempotent(request, () => {
        if (db.locations.some((l) => l.warehouse_id === warehouseId && l.code === body.code)) {
          return Promise.resolve({
            status: 422,
            body: {
              errors: {
                message: 'Bu kod bu depoda zaten var.',
                code: 'VALIDATION_ERROR',
                fields: { code: ['Bu kod bu depoda zaten var.'] },
              },
            },
          })
        }
        db.seq += 1
        const created: WarehouseLocation = {
          id: `loc-${db.seq}`,
          warehouse_id: warehouseId,
          code: body.code ?? '',
          name: body.name ?? '',
          is_active: body.is_active ?? true,
        }
        db.locations.push(created)
        const w = db.warehouses.find((x) => x.id === warehouseId)
        if (w) w.locations_count = (w.locations_count ?? 0) + 1
        return Promise.resolve({ status: 201, body: { data: created } })
      })
    }),
    http.patch(`${API}/warehouses/:id/locations/:loc`, async ({ params, request }) => {
      const l = db.locations.find((x) => x.id === params.loc && x.warehouse_id === params.id)
      if (!l) return notFound()
      const body = (await request.json()) as Partial<WarehouseLocation>
      Object.assign(l, body)
      return HttpResponse.json({ data: l })
    }),
    http.delete(`${API}/warehouses/:id/locations/:loc`, ({ params }) => {
      const l = db.locations.find((x) => x.id === params.loc && x.warehouse_id === params.id)
      if (!l) return notFound()
      if (db.balances.some((b) => b.location_id === l.id))
        return error(422, 'LOCATION_IN_USE', 'Stoku olan lokasyon silinemez.')
      db.locations = db.locations.filter((x) => x.id !== l.id)
      return new HttpResponse(null, { status: 204 })
    }),

    // --- Balances -----------------------------------------------------------------------------
    http.get(`${API}/stock-balances/export`, ({ request }) =>
      exportResponse('stok-durumu', new URL(request.url)),
    ),
    http.get(`${API}/stock-balances`, ({ request }) => {
      const url = new URL(request.url)
      const refused = guard(url, [
        'item_id',
        'warehouse_id',
        'location_id',
        'lot_id',
        'below_reorder',
        'hide_zero',
      ])
      if (refused) return refused
      const group = url.searchParams.get('group_by') ?? 'item_warehouse'
      const q = (url.searchParams.get('q') ?? '').toLocaleLowerCase('tr')
      let rows = db.balances.filter(
        (b) =>
          (!q || `${b.item.code} ${b.item.name}`.toLocaleLowerCase('tr').includes(q)) &&
          (!filterOf(url, 'item_id') || b.item_id === filterOf(url, 'item_id')) &&
          (!filterOf(url, 'warehouse_id') || b.warehouse_id === filterOf(url, 'warehouse_id')) &&
          (filterOf(url, 'below_reorder') !== 'true' ||
            (b.reorder_point != null && new Decimal(b.available).lessThan(b.reorder_point))) &&
          (filterOf(url, 'hide_zero') !== 'true' || !new Decimal(b.on_hand).isZero()),
      )
      if (group === 'item_warehouse') {
        const merged = new Map<string, StockBalance>()
        for (const b of rows) {
          const key = `${b.item_id}:${b.warehouse_id}`
          const prev = merged.get(key)
          if (!prev) {
            merged.set(key, { ...b, location_id: null, location: null, lot_id: null, lot: null })
            continue
          }
          const add = (a: string, c: string, scale: number) => new Decimal(a).plus(c).toFixed(scale)
          prev.on_hand = add(prev.on_hand, b.on_hand, 6)
          prev.reserved = add(prev.reserved, b.reserved, 6)
          prev.available = add(prev.available, b.available, 6)
          prev.value = add(prev.value, b.value, 4)
        }
        rows = [...merged.values()]
      }
      rows = sortBy(rows, url, {
        item_code: (b) => b.item.code,
        warehouse_code: (b) => b.warehouse.code,
      })
      const totalValue = rows.reduce((acc, b) => acc.plus(b.value), new Decimal(0)).toFixed(4)
      const { data, pagination } = paginate(rows, url)
      return HttpResponse.json({ data, meta: { pagination, totals: { value: totalValue } } })
    }),
    http.get(`${API}/items/:id/stock`, ({ params }) => {
      const stock = db.itemStock[String(params.id)]
      return stock ? HttpResponse.json({ data: stock }) : notFound()
    }),

    // --- Movements ----------------------------------------------------------------------------
    http.get(`${API}/stock-movements/export`, ({ request }) =>
      exportResponse('stok-hareketleri', new URL(request.url)),
    ),
    http.get(`${API}/stock-movements`, ({ request }) => {
      const url = new URL(request.url)
      const refused = guard(url, [
        'item_id',
        'warehouse_id',
        'movement_type',
        'direction',
        'date_from',
        'date_to',
        'document_id',
        'lot_id',
        'serial_id',
      ])
      if (refused) return refused
      const perPage = Number(url.searchParams.get('per_page') ?? 25)
      const rows = db.movements
        .filter(
          (m) =>
            (!filterOf(url, 'item_id') || m.item_id === filterOf(url, 'item_id')) &&
            (!filterOf(url, 'warehouse_id') || m.warehouse_id === filterOf(url, 'warehouse_id')) &&
            (!filterOf(url, 'movement_type') ||
              m.movement_type === filterOf(url, 'movement_type')) &&
            (!filterOf(url, 'direction') || m.direction === filterOf(url, 'direction')) &&
            (!filterOf(url, 'lot_id') || m.lot?.id === filterOf(url, 'lot_id')) &&
            (!filterOf(url, 'serial_id') || m.serial?.id === filterOf(url, 'serial_id')) &&
            (!filterOf(url, 'document_id') || m.document_id === filterOf(url, 'document_id')) &&
            (!filterOf(url, 'date_from') ||
              m.occurred_at.slice(0, 10) >= filterOf(url, 'date_from')) &&
            (!filterOf(url, 'date_to') || m.occurred_at.slice(0, 10) <= filterOf(url, 'date_to')),
        )
        .sort((a, b) => b.seq - a.seq)
      // Cursor = seq of the last row returned; the next page continues below it.
      const cursor = url.searchParams.get('cursor')
      const start = cursor ? rows.findIndex((m) => m.seq < Number(cursor)) : 0
      const pageRows = start < 0 ? [] : rows.slice(start, start + perPage)
      const last = pageRows.at(-1)
      const more = start >= 0 && start + perPage < rows.length
      return HttpResponse.json({
        data: pageRows,
        meta: {
          next_cursor: more && last ? String(last.seq) : null,
          prev_cursor: null,
          per_page: perPage,
        },
      })
    }),

    // --- Lots and serials ---------------------------------------------------------------------
    http.get(`${API}/stock-lots/export`, ({ request }) =>
      exportResponse('partiler', new URL(request.url)),
    ),
    http.get(`${API}/stock-lots`, ({ request }) => {
      const url = new URL(request.url)
      const refused = guard(url, ['item_id', 'expiry_status', 'in_stock'])
      if (refused) return refused
      const now = today()
      const soon = addDays(now, 30)
      const status = filterOf(url, 'expiry_status')
      let rows = db.lots.filter((l) => {
        if (filterOf(url, 'item_id') && l.item_id !== filterOf(url, 'item_id')) return false
        if (filterOf(url, 'in_stock') === 'true' && new Decimal(l.on_hand).isZero()) return false
        if (!status) return true
        if (status === 'none') return l.expiry_date === null
        if (l.expiry_date === null) return false
        if (status === 'expired') return l.expiry_date < now
        if (status === 'expiring') return l.expiry_date >= now && l.expiry_date <= soon
        return l.expiry_date > soon
      })
      rows = sortBy(rows, url, {
        lot_no: (l) => l.lot_no,
        expiry_date: (l) => l.expiry_date ?? '9999',
        item_code: (l) => l.item.code,
      })
      const { data, pagination } = paginate(rows, url)
      return HttpResponse.json({ data, meta: { pagination } })
    }),
    http.get(`${API}/stock-lots/:id/trace`, ({ params }) => {
      const trace = db.traces[String(params.id)]
      return trace ? HttpResponse.json({ data: trace }) : notFound()
    }),
    http.get(`${API}/stock-serials/export`, ({ request }) =>
      exportResponse('seri-numaralari', new URL(request.url)),
    ),
    http.get(`${API}/stock-serials`, ({ request }) => {
      const url = new URL(request.url)
      const refused = guard(url, ['item_id', 'warehouse_id', 'status', 'lot_id'])
      if (refused) return refused
      const rows = db.serials.filter(
        (s) =>
          (!filterOf(url, 'status') || s.status === filterOf(url, 'status')) &&
          (!filterOf(url, 'item_id') || s.item_id === filterOf(url, 'item_id')) &&
          (!filterOf(url, 'warehouse_id') || s.warehouse?.id === filterOf(url, 'warehouse_id')),
      )
      const { data, pagination } = paginate(rows, url)
      return HttpResponse.json({ data, meta: { pagination } })
    }),
  ]
}
