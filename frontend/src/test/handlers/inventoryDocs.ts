import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import type {
  ApiStockDocument,
  ImportRow,
  StockDocumentLine,
  StockReservation,
} from '@/features/inventory/documents/types'

// In-memory stand-in for the stock document, reservation and inventory report endpoints as
// assumed from PHASE4 (the backend lane builds them in parallel), plus the read-only lookups the
// screens use: warehouses and locations (Inventory), units, categories, items, item units and
// barcodes (Catalog). Responses use the ApiResponse envelopes and the error envelope of CONTRACT.

export interface InvItem {
  id: string
  code: string
  name: string
  type: 'stock' | 'service'
  base_unit_id: string
  category_id: string | null
  default_tax_code_id: string | null
  purchase_tax_code_id: string | null
  tracking: 'none' | 'lot' | 'serial'
  has_expiry: boolean
  min_stock: string | null
  reorder_point: string | null
  is_active: boolean
  attributes: Record<string, string>
  version: number
}

export interface InvDocsDb {
  warehouses: {
    id: string
    code: string
    name: string
    is_active: boolean
    is_default: boolean
    allow_negative_stock: boolean
  }[]
  locations: { id: string; warehouse_id: string; code: string; name: string; is_active: boolean }[]
  units: {
    id: string
    code: string
    name: string
    symbol: string | null
    is_active: boolean
    version: number
  }[]
  categories: {
    id: string
    code: string
    name: string
    parent_id: string | null
    version: number
  }[]
  items: InvItem[]
  itemUnits: { id: string; item_id: string; unit_id: string; factor: string; version: number }[]
  barcodes: {
    id: string
    item_id: string
    barcode: string
    type: string
    unit_id: string
    variant_id: string | null
    is_primary: boolean
    version: number
  }[]
  documents: ApiStockDocument[]
  reservations: StockReservation[]
  /** Canned report payloads by API path. */
  reports: Record<string, unknown>
  calls: { method: string; path: string; body: unknown; url: URL; headers: Headers }[]
  idempotency: Map<string, { body: string; response: unknown; status: number }>
  /** Uploaded import files (name and text) for assertions. */
  uploads: { name: string; text: string; dryRun: string }[]
  seq: number
  numberSeq: Record<string, number>
}

export const WH_MAIN = 'wh-main'
export const WH_SECOND = 'wh-second'
export const LOC_A1 = 'loc-a1'
export const LOC_A2 = 'loc-a2'
export const UNIT_PCS = 'unit-pcs'
export const UNIT_CASE = 'unit-case'
export const UNIT_KG = 'unit-kg'
export const ITEM_BOLT = 'item-bolt'
export const ITEM_MILK = 'item-milk'
export const ITEM_PHONE = 'item-phone'
export const CAT_HW = 'cat-hw'
export const BARCODE_CASE = '8690000000017'
export const BARCODE_PCS = '8690000000024'
export const DOC_DRAFT = 'sd-draft'
export const DOC_POSTED = 'sd-posted'
export const DOC_COUNT = 'sd-count'
export const RES_ACTIVE = 'res-1'
export const USER_ID = 'u1'

const item = (over: Partial<InvItem> & Pick<InvItem, 'id' | 'code' | 'name'>): InvItem => ({
  type: 'stock',
  base_unit_id: UNIT_PCS,
  category_id: CAT_HW,
  default_tax_code_id: null,
  purchase_tax_code_id: null,
  tracking: 'none',
  has_expiry: false,
  min_stock: null,
  reorder_point: null,
  is_active: true,
  attributes: {},
  version: 1,
  ...over,
})

function line(
  docId: string,
  no: number,
  over: Partial<StockDocumentLine> & Pick<StockDocumentLine, 'item_id' | 'quantity'>,
): StockDocumentLine {
  return {
    id: `${docId}-l${no}`,
    line_no: no,
    unit_id: UNIT_PCS,
    base_quantity: over.quantity,
    unit_cost: null,
    lot_no: null,
    expiry_date: null,
    serial_numbers: [],
    location_id: null,
    ...over,
  }
}

const baseDoc = {
  target_warehouse_id: null,
  target_warehouse_code: null,
  target_warehouse_name: null,
  reason: null,
  notes: null,
  source_type: null,
  source_id: null,
  journal_entry_id: null,
  posted_at: null,
  posted_by: null,
  reversed_at: null,
  reversal_reason: null,
  reversal_date: null,
  frozen_at: null,
  total_cost: null,
  warehouse_id: WH_MAIN,
  warehouse_code: 'ANA',
  warehouse_name: 'Ana depo',
}

export function createInvDocsDb(overrides: Partial<InvDocsDb> = {}): InvDocsDb {
  return {
    warehouses: [
      {
        id: WH_MAIN,
        code: 'ANA',
        name: 'Ana depo',
        is_active: true,
        is_default: true,
        allow_negative_stock: false,
      },
      {
        id: WH_SECOND,
        code: 'SUBE',
        name: 'Şube deposu',
        is_active: true,
        is_default: false,
        allow_negative_stock: false,
      },
    ],
    locations: [
      { id: LOC_A1, warehouse_id: WH_MAIN, code: 'A-01', name: 'Raf A-01', is_active: true },
      { id: LOC_A2, warehouse_id: WH_MAIN, code: 'A-02', name: 'Raf A-02', is_active: true },
    ],
    units: [
      { id: UNIT_PCS, code: 'ADET', name: 'Adet', symbol: null, is_active: true, version: 1 },
      { id: UNIT_CASE, code: 'KOLI', name: 'Koli', symbol: null, is_active: true, version: 1 },
      { id: UNIT_KG, code: 'KG', name: 'Kilogram', symbol: 'kg', is_active: true, version: 1 },
    ],
    categories: [{ id: CAT_HW, code: 'HRD', name: 'Hırdavat', parent_id: null, version: 1 }],
    items: [
      item({ id: ITEM_BOLT, code: 'STK-001', name: 'Cıvata M8', reorder_point: '100.000000' }),
      item({ id: ITEM_MILK, code: 'STK-002', name: 'Süt 1L', tracking: 'lot', has_expiry: true }),
      item({ id: ITEM_PHONE, code: 'STK-003', name: 'Telefon X', tracking: 'serial' }),
    ],
    itemUnits: [
      { id: 'iu-1', item_id: ITEM_BOLT, unit_id: UNIT_CASE, factor: '24.000000', version: 1 },
    ],
    barcodes: [
      {
        id: 'bc-1',
        item_id: ITEM_BOLT,
        barcode: BARCODE_CASE,
        type: 'ean13',
        unit_id: UNIT_CASE,
        variant_id: null,
        is_primary: false,
        version: 1,
      },
      {
        id: 'bc-2',
        item_id: ITEM_BOLT,
        barcode: BARCODE_PCS,
        type: 'ean13',
        unit_id: UNIT_PCS,
        variant_id: null,
        is_primary: true,
        version: 1,
      },
    ],
    documents: [
      {
        ...baseDoc,
        id: DOC_DRAFT,
        doc_type: 'receipt',
        number: null,
        status: 'draft',
        document_date: '2026-10-15',
        reason: 'Tedarikçi teslimatı',
        line_count: 1,
        created_at: '2026-10-15T08:00:00Z',
        version: 2,
        lines: [
          line(DOC_DRAFT, 1, {
            item_id: ITEM_BOLT,
            item_code: 'STK-001',
            item_name: 'Cıvata M8',
            item_tracking: 'none',
            item_has_expiry: false,
            base_unit_id: UNIT_PCS,
            base_unit_code: 'ADET',
            unit_code: 'ADET',
            quantity: '10.000000',
            unit_cost: '2.500000',
            total_cost: '25.0000',
          }),
        ],
        audit: [
          {
            event: 'created',
            description: 'created',
            causer_id: USER_ID,
            created_at: '2026-10-15T08:00:00Z',
          },
        ],
      },
      {
        ...baseDoc,
        id: DOC_POSTED,
        doc_type: 'issue',
        number: 'CIK-2026-000001',
        status: 'posted',
        document_date: '2026-10-10',
        reason: 'Üretime sarf',
        journal_entry_id: 'je-77',
        posted_at: '2026-10-10T12:00:00Z',
        posted_by: USER_ID,
        total_cost: '50.0000',
        line_count: 1,
        created_at: '2026-10-10T11:00:00Z',
        version: 3,
        lines: [
          line(DOC_POSTED, 1, {
            item_id: ITEM_BOLT,
            item_code: 'STK-001',
            item_name: 'Cıvata M8',
            base_unit_code: 'ADET',
            unit_code: 'ADET',
            quantity: '20.000000',
            unit_cost: '2.500000',
            total_cost: '50.0000',
          }),
        ],
        audit: [],
      },
      {
        ...baseDoc,
        id: DOC_COUNT,
        doc_type: 'count',
        number: null,
        status: 'draft',
        document_date: '2026-10-20',
        frozen_at: '2026-10-20T07:00:00Z',
        line_count: 3,
        created_at: '2026-10-20T07:00:00Z',
        version: 1,
        lines: [
          line(DOC_COUNT, 1, {
            item_id: ITEM_BOLT,
            item_code: 'STK-001',
            item_name: 'Cıvata M8',
            unit_code: 'ADET',
            quantity: '0',
            system_quantity: '100.000000',
            counted_quantity: null,
            unit_cost: '2.500000',
            location_id: LOC_A1,
            location_code: 'A-01',
          }),
          line(DOC_COUNT, 2, {
            item_id: ITEM_MILK,
            item_code: 'STK-002',
            item_name: 'Süt 1L',
            unit_code: 'ADET',
            quantity: '0',
            lot_no: 'L-0925',
            system_quantity: '40.000000',
            counted_quantity: null,
            unit_cost: '30.000000',
            location_id: LOC_A1,
            location_code: 'A-01',
          }),
          line(DOC_COUNT, 3, {
            item_id: ITEM_PHONE,
            item_code: 'STK-003',
            item_name: 'Telefon X',
            unit_code: 'ADET',
            quantity: '0',
            system_quantity: '5.000000',
            counted_quantity: '5.000000',
            unit_cost: '1000.000000',
            location_id: LOC_A2,
            location_code: 'A-02',
          }),
        ],
        audit: [],
      },
    ],
    reservations: [
      {
        id: RES_ACTIVE,
        item_id: ITEM_BOLT,
        item_code: 'STK-001',
        item_name: 'Cıvata M8',
        warehouse_id: WH_MAIN,
        warehouse_code: 'ANA',
        lot_id: null,
        lot_no: null,
        quantity: '12.000000',
        unit_code: 'ADET',
        status: 'active',
        source_type: 'sales_order',
        source_id: 'so-1',
        source_label: 'SIP-2026-000004',
        expires_at: '2026-11-01T00:00:00Z',
        created_by: USER_ID,
        created_at: '2026-10-18T09:00:00Z',
        version: 1,
      },
      {
        id: 'res-2',
        item_id: ITEM_MILK,
        item_code: 'STK-002',
        item_name: 'Süt 1L',
        warehouse_id: WH_MAIN,
        warehouse_code: 'ANA',
        lot_id: 'lot-1',
        lot_no: 'L-0925',
        quantity: '6.000000',
        unit_code: 'ADET',
        status: 'released',
        source_type: 'sales_order',
        source_id: 'so-2',
        source_label: 'SIP-2026-000005',
        expires_at: null,
        created_by: USER_ID,
        created_at: '2026-10-17T09:00:00Z',
        version: 2,
      },
    ],
    reports: defaultReports(),
    calls: [],
    idempotency: new Map(),
    uploads: [],
    seq: 0,
    numberSeq: {},
    ...overrides,
  }
}

function defaultReports(): Record<string, unknown> {
  return {
    '/inventory-reports/stock-status': {
      as_of: '2026-10-21',
      rows: [
        {
          item_id: ITEM_BOLT,
          item_code: 'STK-001',
          item_name: 'Cıvata M8',
          unit_code: 'ADET',
          warehouse_code: 'ANA',
          on_hand: '100.000000',
          reserved: '12.000000',
          available: '88.000000',
          avg_cost: '2.500000',
          value: '250.0000',
        },
        {
          item_id: ITEM_MILK,
          item_code: 'STK-002',
          item_name: 'Süt 1L',
          unit_code: 'ADET',
          warehouse_code: 'ANA',
          on_hand: '40.000000',
          reserved: '0.000000',
          available: '40.000000',
          avg_cost: '30.000000',
          value: '1200.0000',
        },
      ],
      totals: { value: '1450.0000' },
    },
    '/inventory-reports/stock-ledger': {
      item: { id: ITEM_BOLT, code: 'STK-001', name: 'Cıvata M8' },
      opening: { quantity: '50.000000', value: '125.0000' },
      rows: [
        {
          movement_id: 'm1',
          occurred_at: '2026-10-05T10:00:00Z',
          document_type: 'stock_document',
          document_id: DOC_POSTED,
          document_number: 'GIR-2026-000003',
          movement_type: 'receipt',
          warehouse_code: 'ANA',
          lot_no: null,
          in_quantity: '70.000000',
          out_quantity: '0.000000',
          unit_cost: '2.500000',
          in_value: '175.0000',
          out_value: '0.0000',
          balance_quantity: '120.000000',
          balance_value: '300.0000',
        },
        {
          movement_id: 'm2',
          occurred_at: '2026-10-10T12:00:00Z',
          document_type: 'stock_document',
          document_id: DOC_POSTED,
          document_number: 'CIK-2026-000001',
          movement_type: 'issue',
          warehouse_code: 'ANA',
          lot_no: null,
          in_quantity: '0.000000',
          out_quantity: '20.000000',
          unit_cost: '2.500000',
          in_value: '0.0000',
          out_value: '50.0000',
          balance_quantity: '100.000000',
          balance_value: '250.0000',
        },
      ],
      closing: { quantity: '100.000000', value: '250.0000' },
    },
    '/inventory-reports/valuation': {
      method: 'moving_average',
      rows: [
        {
          item_code: 'STK-001',
          item_name: 'Cıvata M8',
          unit_code: 'ADET',
          warehouse_code: 'ANA',
          quantity: '100.000000',
          avg_cost: '2.500000',
          value: '250.0000',
        },
      ],
    },
    '/inventory-reports/ageing': {
      rows: [
        {
          item_code: 'STK-001',
          item_name: 'Cıvata M8',
          unit_code: 'ADET',
          quantity: '100.000000',
          value: '250.0000',
          buckets: {
            d0_30: { quantity: '70.000000', value: '175.0000' },
            d31_60: { quantity: '30.000000', value: '75.0000' },
            d61_90: { quantity: '0', value: '0.0000' },
            d90_plus: { quantity: '0', value: '0.0000' },
          },
        },
      ],
    },
    '/inventory-reports/expiring-lots': {
      rows: [
        {
          item_code: 'STK-002',
          item_name: 'Süt 1L',
          lot_no: 'L-0925',
          expiry_date: '2026-11-05',
          days_left: '15',
          warehouse_code: 'ANA',
          quantity: '40.000000',
          value: '1200.0000',
        },
      ],
    },
    '/inventory-reports/abc-analysis': {
      rows: [
        {
          item_code: 'STK-002',
          item_name: 'Süt 1L',
          quantity: '300.000000',
          value: '9000.0000',
          share: '90.00',
          cumulative_share: '90.00',
          class: 'A',
        },
        {
          item_code: 'STK-001',
          item_name: 'Cıvata M8',
          quantity: '400.000000',
          value: '1000.0000',
          share: '10.00',
          cumulative_share: '100.00',
          class: 'C',
        },
      ],
    },
    '/inventory-reports/turnover': {
      rows: [
        {
          item_code: 'STK-001',
          item_name: 'Cıvata M8',
          opening_value: '125.0000',
          closing_value: '250.0000',
          average_inventory: '187.5000',
          cogs: '1500.0000',
          turnover_ratio: '8.00',
          days_on_hand: '45.6',
        },
      ],
    },
    '/reports/reorder-suggestions': {
      rows: [
        {
          item_code: 'STK-001',
          item_name: 'Cıvata M8',
          unit_code: 'ADET',
          warehouse_code: 'ANA',
          on_hand: '100.000000',
          reserved: '12.000000',
          available: '88.000000',
          min_stock: '50.000000',
          reorder_point: '100.000000',
          suggested_quantity: '112.000000',
        },
      ],
    },
  }
}

const API = '*/api/v1'
const D = (v: unknown) =>
  new Decimal(typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v) ? v : '0')
const QTY = /^-?\d{1,14}(\.\d{1,6})?$/

function error(status: number, code: string, message: string, fields?: Record<string, string[]>) {
  return HttpResponse.json({ errors: { message, code, ...(fields ? { fields } : {}) } }, { status })
}
const validation = (fields: Record<string, string[]>) =>
  error(422, 'VALIDATION_ERROR', Object.values(fields)[0]?.[0] ?? 'Geçersiz.', fields)
const notFound = () => error(404, 'NOT_FOUND', 'Kayıt bulunamadı.')
const conflict = () =>
  error(409, 'VERSION_CONFLICT', 'Kayıt siz düzenlerken başka biri tarafından değiştirildi.')

function paginate<T>(rows: T[], url: URL, defaultPerPage = 25) {
  const perPage = Math.min(100, Number(url.searchParams.get('per_page') ?? defaultPerPage))
  const page = Number(url.searchParams.get('page') ?? 1)
  return {
    data: rows.slice((page - 1) * perPage, page * perPage),
    meta: {
      pagination: {
        total: rows.length,
        current_page: page,
        per_page: perPage,
        last_page: Math.max(1, Math.ceil(rows.length / perPage)),
      },
    },
  }
}

const has = (q: string, ...values: (string | null | undefined)[]) => {
  const needle = q.trim().toLocaleLowerCase('tr')
  return !needle || values.some((v) => v?.toLocaleLowerCase('tr').includes(needle))
}

interface LineBody {
  item_id?: string
  unit_id?: string
  quantity?: string
  unit_cost?: string | null
  lot_no?: string | null
  expiry_date?: string | null
  serial_numbers?: string[]
  location_id?: string | null
  target_location_id?: string | null
}

export function invDocsHandlers(db: InvDocsDb) {
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
      url,
      headers: request.headers,
    })
    return undefined
  })

  const find = (id: string) => db.documents.find((d) => d.id === id)
  const itemOf = (id: string | undefined) => db.items.find((i) => i.id === id)
  const unitOf = (id: string | undefined) => db.units.find((u) => u.id === id)
  const factorOf = (itemId: string, unitId: string) => {
    const it = itemOf(itemId)
    if (it?.base_unit_id === unitId) return new Decimal(1)
    const alt = db.itemUnits.find((u) => u.item_id === itemId && u.unit_id === unitId)
    return alt ? new Decimal(alt.factor) : null
  }
  const warehouse = (id: string | null | undefined) => db.warehouses.find((w) => w.id === id)
  const location = (id: string | null | undefined) => db.locations.find((l) => l.id === id)

  function validateDoc(body: Record<string, unknown>, creating: boolean) {
    const fields: Record<string, string[]> = {}
    const lines = Array.isArray(body.lines) ? (body.lines as LineBody[]) : []
    if (!creating && typeof body.version !== 'number') fields.version = ['Sürüm zorunlu.']
    if (!['receipt', 'issue', 'transfer', 'adjustment', 'opening'].includes(String(body.doc_type)))
      fields.doc_type = ['Fiş türü geçersiz.']
    if (!warehouse(body.warehouse_id as string)) fields.warehouse_id = ['Depo bulunamadı.']
    if (body.doc_type === 'transfer' && !warehouse(body.target_warehouse_id as string))
      fields.target_warehouse_id = ['Hedef depo zorunlu.']
    if (lines.length === 0) fields.lines = ['En az bir satır gerekli.']
    if (lines.length > 500) fields.lines = ['En çok 500 satır olabilir.']
    lines.forEach((l, i) => {
      const it = itemOf(l.item_id)
      if (!it) fields[`lines.${i}.item_id`] = ['Stok kartı bulunamadı.']
      if (it && !factorOf(it.id, l.unit_id ?? ''))
        fields[`lines.${i}.unit_id`] = ['Birim bu kart için tanımlı değil.']
      if (!l.quantity || !QTY.test(l.quantity)) fields[`lines.${i}.quantity`] = ['Miktar geçersiz.']
      if (
        it?.tracking === 'lot' &&
        ['receipt', 'opening'].includes(String(body.doc_type)) &&
        !l.lot_no
      )
        fields[`lines.${i}.lot_no`] = ['Lot numarası zorunlu.']
    })
    return fields
  }

  function buildLines(docId: string, lines: LineBody[]): StockDocumentLine[] {
    return lines.map((l, i) => {
      const it = itemOf(l.item_id)
      const factor = factorOf(l.item_id ?? '', l.unit_id ?? '') ?? new Decimal(1)
      const qty = D(l.quantity)
      return {
        id: `${docId}-l${i + 1}`,
        line_no: i + 1,
        item_id: l.item_id ?? '',
        item_code: it?.code ?? null,
        item_name: it?.name ?? null,
        item_tracking: it?.tracking ?? 'none',
        item_has_expiry: it?.has_expiry ?? false,
        base_unit_id: it?.base_unit_id ?? null,
        base_unit_code: unitOf(it?.base_unit_id)?.code ?? null,
        unit_id: l.unit_id ?? '',
        unit_code: unitOf(l.unit_id)?.code ?? null,
        quantity: qty.toFixed(6),
        base_quantity: qty.mul(factor).toFixed(6),
        unit_cost: l.unit_cost ?? null,
        total_cost: l.unit_cost ? qty.mul(D(l.unit_cost)).toFixed(4) : null,
        lot_no: l.lot_no ?? null,
        expiry_date: l.expiry_date ?? null,
        serial_numbers: l.serial_numbers ?? [],
        location_id: l.location_id ?? null,
        location_code: location(l.location_id)?.code ?? null,
        target_location_id: l.target_location_id ?? null,
        target_location_code: location(l.target_location_id)?.code ?? null,
      }
    })
  }

  function docFields(body: Record<string, unknown>) {
    const wh = warehouse(body.warehouse_id as string)
    const target = warehouse(body.target_warehouse_id as string)
    return {
      doc_type: body.doc_type as ApiStockDocument['doc_type'],
      document_date: String(body.document_date),
      warehouse_id: wh?.id ?? '',
      warehouse_code: wh?.code ?? null,
      warehouse_name: wh?.name ?? null,
      target_warehouse_id: target?.id ?? null,
      target_warehouse_code: target?.code ?? null,
      target_warehouse_name: target?.name ?? null,
      reason: (body.reason as string | null) ?? null,
      notes: (body.notes as string | null) ?? null,
    }
  }

  const totalCost = (lines: StockDocumentLine[]) => {
    const costed = lines.filter((l) => l.total_cost)
    return costed.length
      ? costed.reduce((s, l) => s.plus(D(l.total_cost)), new Decimal(0)).toFixed(4)
      : null
  }

  /** Replays an identical retry; a reused key with another body is refused. */
  function idempotent(
    request: Request,
    payload: unknown,
    run: () => { status: number; body: unknown } | Response,
  ) {
    const key = request.headers.get('Idempotency-Key')
    if (!key) return error(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key gerekli.')
    const text = JSON.stringify(payload)
    const prior = db.idempotency.get(key)
    if (prior) {
      if (prior.body !== text)
        return error(422, 'IDEMPOTENCY_KEY_REUSED', 'Anahtar başka bir istekle kullanıldı.')
      return HttpResponse.json(prior.response as Record<string, unknown>, { status: prior.status })
    }
    const out = run()
    if (out instanceof Response) return out
    db.idempotency.set(key, { body: text, response: out.body, status: out.status })
    return HttpResponse.json(out.body as Record<string, unknown>, { status: out.status })
  }

  const summary = (d: ApiStockDocument) => {
    const out: Partial<ApiStockDocument> = { ...d, line_count: d.lines.length }
    delete out.lines
    delete out.audit
    return out
  }

  return [
    record,
    // ---- lookups --------------------------------------------------------------------------
    http.get(`${API}/warehouses`, ({ request }) =>
      HttpResponse.json(paginate(db.warehouses, new URL(request.url))),
    ),
    http.get(`${API}/warehouses/:id/locations`, ({ request, params }) =>
      HttpResponse.json(
        paginate(
          db.locations.filter((l) => l.warehouse_id === params.id),
          new URL(request.url),
        ),
      ),
    ),
    http.get(`${API}/units`, ({ request }) =>
      HttpResponse.json(paginate(db.units, new URL(request.url))),
    ),
    http.get(`${API}/item-categories`, ({ request }) =>
      HttpResponse.json(paginate(db.categories, new URL(request.url))),
    ),
    http.get(`${API}/items`, ({ request }) => {
      const url = new URL(request.url)
      const q = url.searchParams.get('q') ?? ''
      const rows = db.items.filter(
        (i) =>
          has(q, i.code, i.name) ||
          db.barcodes.some((b) => b.item_id === i.id && b.barcode.includes(q.trim())),
      )
      return HttpResponse.json(paginate(rows, url))
    }),
    http.get(`${API}/items/:id`, ({ params }) => {
      const it = itemOf(String(params.id))
      return it ? HttpResponse.json({ data: it }) : notFound()
    }),
    http.get(`${API}/items/:id/units`, ({ request, params }) =>
      HttpResponse.json(
        paginate(
          db.itemUnits.filter((u) => u.item_id === params.id),
          new URL(request.url),
        ),
      ),
    ),
    http.get(`${API}/items/:id/barcodes`, ({ request, params }) => {
      const url = new URL(request.url)
      const code = url.searchParams.get('filter[barcode]')
      return HttpResponse.json(
        paginate(
          db.barcodes.filter((b) => b.item_id === params.id && (!code || b.barcode === code)),
          url,
        ),
      )
    }),
    // ---- stock documents --------------------------------------------------------------------
    http.get(`${API}/stock-documents/export`, ({ request }) => {
      const url = new URL(request.url)
      const format = url.searchParams.get('format') ?? 'csv'
      return new HttpResponse('number,type\n', {
        headers: {
          'Content-Type':
            format === 'xlsx'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : 'text/csv',
          'Content-Disposition': `attachment; filename="stok-fisleri.${format}"`,
        },
      })
    }),
    http.get(`${API}/stock-documents`, ({ request }) => {
      const url = new URL(request.url)
      const f = (k: string) => url.searchParams.get(`filter[${k}]`) ?? ''
      const q = url.searchParams.get('q') ?? ''
      const rows = db.documents
        .filter((d) => !f('doc_type') || d.doc_type === f('doc_type'))
        .filter((d) => !f('status') || d.status === f('status'))
        .filter(
          (d) =>
            !f('warehouse_id') ||
            d.warehouse_id === f('warehouse_id') ||
            d.target_warehouse_id === f('warehouse_id'),
        )
        .filter((d) => !f('item_id') || d.lines.some((l) => l.item_id === f('item_id')))
        .filter((d) => !f('date_from') || d.document_date >= f('date_from'))
        .filter((d) => !f('date_to') || d.document_date <= f('date_to'))
        .filter((d) => has(q, d.number, d.reason))
        .sort((a, b) => b.document_date.localeCompare(a.document_date))
      return HttpResponse.json(paginate(rows.map(summary), url))
    }),
    http.get(`${API}/stock-documents/:id`, ({ params }) => {
      const d = find(String(params.id))
      return d ? HttpResponse.json({ data: d }) : notFound()
    }),
    http.post(`${API}/stock-documents`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      return idempotent(request, body, () => {
        if (body.doc_type === 'count') {
          const wh = warehouse(body.warehouse_id as string)
          if (!wh) return validation({ warehouse_id: ['Depo bulunamadı.'] })
          db.seq += 1
          const id = `sd-new-${db.seq}`
          const lines = buildLines(id, [
            { item_id: ITEM_BOLT, unit_id: UNIT_PCS, quantity: '0' },
          ]).map((l) => ({
            ...l,
            system_quantity: '7.000000',
            counted_quantity: null,
            unit_cost: '2.500000',
            total_cost: null,
          }))
          const doc: ApiStockDocument = {
            ...baseDoc,
            ...docFields({ ...body, doc_type: 'count' }),
            id,
            number: null,
            status: 'draft',
            frozen_at: '2026-10-21T09:00:00Z',
            created_at: '2026-10-21T09:00:00Z',
            version: 1,
            lines,
            audit: [],
          }
          db.documents.unshift(doc)
          return { status: 201, body: { data: doc } }
        }
        const fields = validateDoc(body, true)
        if (Object.keys(fields).length) return validation(fields)
        db.seq += 1
        const id = `sd-new-${db.seq}`
        const lines = buildLines(id, body.lines as LineBody[])
        const doc: ApiStockDocument = {
          ...baseDoc,
          ...docFields(body),
          id,
          number: null,
          status: 'draft',
          total_cost: totalCost(lines),
          created_at: '2026-10-21T09:00:00Z',
          version: 1,
          lines,
          audit: [
            {
              event: 'created',
              description: 'created',
              causer_id: USER_ID,
              created_at: '2026-10-21T09:00:00Z',
            },
          ],
        }
        db.documents.unshift(doc)
        return { status: 201, body: { data: doc } }
      })
    }),
    http.patch(`${API}/stock-documents/:id`, async ({ request, params }) => {
      const d = find(String(params.id))
      if (!d) return notFound()
      const body = (await request.json()) as Record<string, unknown>
      if (d.status !== 'draft')
        return error(422, 'DOCUMENT_NOT_DRAFT', 'Yalnızca taslak değiştirilebilir.')
      if (body.version !== d.version) return conflict()
      if (d.doc_type === 'count') {
        const updates = (body.lines ?? []) as { id: string; counted_quantity: string | null }[]
        const fields: Record<string, string[]> = {}
        updates.forEach((u, i) => {
          if (!d.lines.some((l) => l.id === u.id)) fields[`lines.${i}.id`] = ['Satır bulunamadı.']
          if (u.counted_quantity !== null && !QTY.test(u.counted_quantity))
            fields[`lines.${i}.counted_quantity`] = ['Miktar geçersiz.']
        })
        if (Object.keys(fields).length) return validation(fields)
        for (const u of updates) {
          const l = d.lines.find((x) => x.id === u.id)
          if (l)
            l.counted_quantity =
              u.counted_quantity === null ? null : D(u.counted_quantity).toFixed(6)
        }
        d.version += 1
        return HttpResponse.json({ data: d })
      }
      const fields = validateDoc(body, false)
      if (Object.keys(fields).length) return validation(fields)
      Object.assign(d, docFields(body))
      d.lines = buildLines(d.id, body.lines as LineBody[])
      d.total_cost = totalCost(d.lines)
      d.version += 1
      return HttpResponse.json({ data: d })
    }),
    http.delete(`${API}/stock-documents/:id`, ({ request, params }) => {
      const d = find(String(params.id))
      if (!d) return notFound()
      const version = Number(new URL(request.url).searchParams.get('version'))
      if (d.status !== 'draft')
        return error(422, 'DOCUMENT_NOT_DRAFT', 'Yalnızca taslak silinebilir.')
      if (version !== d.version) return conflict()
      db.documents = db.documents.filter((x) => x.id !== d.id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/stock-documents/:id/post`, async ({ request, params }) => {
      const d = find(String(params.id))
      if (!d) return notFound()
      const body = (await request.json()) as { version?: number }
      return idempotent(request, { id: d.id, ...body }, () => {
        if (d.status !== 'draft') return error(422, 'DOCUMENT_NOT_DRAFT', 'Fiş zaten kesinleşmiş.')
        if (body.version !== d.version) return conflict()
        if (d.doc_type === 'count' && d.lines.some((l) => l.counted_quantity === null))
          return validation({ lines: ['Sayılmamış satırlar var.'] })
        const prefix = {
          receipt: 'GIR',
          issue: 'CIK',
          transfer: 'TRF',
          count: 'SAY',
          adjustment: 'DZT',
          opening: 'ACL',
        }[d.doc_type]
        const n = (db.numberSeq[d.doc_type] ?? 0) + 1
        db.numberSeq[d.doc_type] = n
        d.number = `${prefix}-2026-${String(n).padStart(6, '0')}`
        d.status = 'posted'
        d.posted_at = '2026-10-21T10:00:00Z'
        d.posted_by = USER_ID
        d.journal_entry_id = d.doc_type === 'transfer' ? null : `je-${d.id}`
        d.version += 1
        return { status: 200, body: { data: d } }
      })
    }),
    http.post(`${API}/stock-documents/:id/reverse`, async ({ request, params }) => {
      const d = find(String(params.id))
      if (!d) return notFound()
      const body = (await request.json()) as { date?: string; reason?: string; version?: number }
      return idempotent(request, { id: d.id, ...body }, () => {
        if (d.status !== 'posted')
          return error(422, 'DOCUMENT_NOT_POSTED', 'Yalnızca kesinleşmiş fiş ters kayda alınır.')
        if (body.version !== d.version) return conflict()
        if (!body.reason || body.reason.trim().length < 3)
          return validation({ reason: ['Gerekçe zorunlu.'] })
        d.status = 'cancelled'
        d.reversed_at = '2026-10-21T11:00:00Z'
        d.reversal_date = body.date ?? null
        d.reversal_reason = body.reason
        d.version += 1
        return { status: 200, body: { data: d } }
      })
    }),
    http.post(`${API}/stock-documents/:id/lines/import`, async ({ request, params }) => {
      const d = find(String(params.id))
      if (!d) return notFound()
      const form = await request.formData()
      const file = form.get('file')
      const flag = form.get('dry_run')
      const dryRun = typeof flag === 'string' ? flag : ''
      // jsdom and Node each have their own File class: check the shape, not the constructor.
      if (file === null || typeof file === 'string') return validation({ file: ['Dosya zorunlu.'] })
      if (Number(form.get('version')) !== d.version) return conflict()
      const text = await file.text()
      db.uploads.push({ name: file.name, text, dryRun })
      const rows: ImportRow[] = text
        .split(/\r?\n/)
        .slice(1)
        .filter((r) => r.trim() !== '')
        .map((r, i) => {
          const [code = '', lot = '', loc = '', qty = ''] = r.split(',').map((c) => c.trim())
          const match = d.lines.find(
            (l) =>
              l.item_code === code && (l.lot_no ?? '') === lot && (l.location_code ?? '') === loc,
          )
          const ok = Boolean(match) && QTY.test(qty)
          return {
            row: i + 2,
            item_code: code,
            lot_no: lot || null,
            location_code: loc || null,
            counted_quantity: qty || null,
            line_id: match?.id ?? null,
            status: ok ? 'ok' : 'error',
            message: ok ? null : match ? 'Miktar geçersiz.' : 'Sayım satırı bulunamadı.',
          }
        })
      const valid = rows.filter((r) => r.status === 'ok').length
      const invalid = rows.length - valid
      if (dryRun === '1' || invalid > 0) {
        return HttpResponse.json({ data: { dry_run: true, rows, valid, invalid, document: null } })
      }
      for (const r of rows) {
        const l = d.lines.find((x) => x.id === r.line_id)
        if (l && r.counted_quantity) l.counted_quantity = D(r.counted_quantity).toFixed(6)
      }
      d.version += 1
      return HttpResponse.json({ data: { dry_run: false, rows, valid, invalid, document: d } })
    }),
    // ---- reservations -----------------------------------------------------------------------
    http.get(`${API}/stock-reservations`, ({ request }) => {
      const url = new URL(request.url)
      const f = (k: string) => url.searchParams.get(`filter[${k}]`) ?? ''
      const rows = db.reservations
        .filter((r) => !f('status') || r.status === f('status'))
        .filter((r) => !f('warehouse_id') || r.warehouse_id === f('warehouse_id'))
        .filter((r) => !f('item_id') || r.item_id === f('item_id'))
      return HttpResponse.json(paginate(rows, url))
    }),
    http.post(`${API}/stock-reservations/:id/release`, async ({ request, params }) => {
      const r = db.reservations.find((x) => x.id === params.id)
      if (!r) return notFound()
      const body = (await request.json()) as { version?: number }
      if (body.version !== r.version) return conflict()
      if (r.status !== 'active')
        return error(422, 'RESERVATION_NOT_ACTIVE', 'Rezervasyon etkin değil.')
      r.status = 'released'
      r.version += 1
      return HttpResponse.json({ data: r })
    }),
    // ---- reports ----------------------------------------------------------------------------
    http.get(`${API}/inventory-reports/:name/export`, ({ request, params }) => {
      const format = new URL(request.url).searchParams.get('format') ?? 'csv'
      return new HttpResponse('a,b\n', {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${String(params.name)}.${format}"`,
        },
      })
    }),
    http.get(`${API}/inventory-reports/:name`, ({ request, params }) => {
      const url = new URL(request.url)
      const path = `/inventory-reports/${String(params.name)}`
      if (params.name === 'stock-ledger' && !url.searchParams.get('item_id'))
        return validation({ item_id: ['Stok kartı zorunlu.'] })
      const data = db.reports[path]
      return data ? HttpResponse.json({ data }) : notFound()
    }),
    http.get(`${API}/reports/reorder-suggestions`, () =>
      HttpResponse.json({ data: db.reports['/reports/reorder-suggestions'] }),
    ),
  ]
}
