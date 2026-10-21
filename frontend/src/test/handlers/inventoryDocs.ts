import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import type {
  ApiStockDocument,
  StockDocumentLine,
  StockReservation,
} from '@/features/inventory/documents/types'

// In-memory stand-in for the Inventory stock document, reservation and report endpoints as the
// backend implements them (routes.php, FormRequests, StockDocuments, LineImport, StockLedger,
// InventoryReportController), plus the read-only lookups the screens use: /stock-warehouses and
// the Reference locations, Catalog units, categories, items, item units and barcodes, stock lots.
// Resources carry ids only (no item/warehouse labels), like the API. Errors use the envelope
// {errors: {message, code, fields?}}.

const WAREHOUSE_READERS = [
  'inventory.warehouses.view',
  'inventory.warehouses.manage',
  'inventory.stock.view',
  'inventory.documents.view',
  'inventory.reservations.manage',
]

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

export interface InvWarehouse {
  id: string
  code: string
  name: string
  is_active: boolean
  is_default: boolean
  negative_stock_policy: 'allow' | 'warn' | 'block'
  allow_negative_stock: boolean
  reservation_policy: 'none' | 'soft' | 'hard'
  version: number
}

export interface InvLocation {
  id: string
  warehouse_id: string
  code: string
  name: string
  is_active: boolean
  parent_id: string | null
  type: 'aisle' | 'rack' | 'shelf' | 'bin'
}

/** On-hand stock per balance key, the source of count snapshots. */
export interface InvBalance {
  item_id: string
  warehouse_id: string
  location_id: string | null
  lot_no: string | null
  on_hand: string
}

/** A canned report: every row (the handler pages them) and the report meta. */
export interface CannedReport {
  rows: Record<string, unknown>[]
  meta: Record<string, unknown>
}

export interface InvDocsDb {
  warehouses: InvWarehouse[]
  locations: InvLocation[]
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
  lots: {
    id: string
    item_id: string
    lot_no: string
    expiry_date: string | null
    on_hand: string
  }[]
  balances: InvBalance[]
  documents: ApiStockDocument[]
  reservations: StockReservation[]
  /** Canned stock reports by API path; reorder suggestions are a plain row list. */
  reports: Record<string, CannedReport>
  reorder: Record<string, unknown>[]
  /** Permissions of the signed-in user the API checks itself (issue_expired at posting). */
  permissions: string[]
  calls: { method: string; path: string; body: unknown; url: URL; headers: Headers }[]
  /** Number of ids per GET /items?filter[id] request (0 without the filter). */
  itemIdBatches: number[]
  idempotency: Map<string, { body: string; response: unknown; status: number }>
  /** Uploaded import files (name, text, dry_run flag) for assertions. */
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
export const ITEM_NUT = 'item-nut'
export const LOT_MILK = 'lot-milk-0925'
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

/** A StockDocumentLineResource row. */
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
    target_location_id: null,
    direction: null,
    system_quantity: null,
    counted_quantity: null,
    difference: null,
    reservation_id: null,
    notes: null,
    ...over,
  }
}

/** StockDocumentResource fields of a fresh draft. */
const baseDoc = {
  target_warehouse_id: null,
  reason: null,
  notes: null,
  offset_event: null,
  allow_expired: false,
  source_type: null,
  source_id: null,
  journal_entry_id: null,
  frozen_at: null,
  posted_at: null,
  posted_by: null,
  reversal_date: null,
  reversal_reason: null,
  reversal_journal_entry_id: null,
  reversed_at: null,
  reversed_by: null,
  created_by: USER_ID,
  warehouse_id: WH_MAIN,
  updated_at: null,
}

const warehouse = (over: Partial<InvWarehouse> & Pick<InvWarehouse, 'id' | 'code' | 'name'>) => ({
  is_active: true,
  is_default: false,
  negative_stock_policy: 'block' as const,
  allow_negative_stock: false,
  reservation_policy: 'soft' as const,
  version: 1,
  ...over,
})

export function createInvDocsDb(overrides: Partial<InvDocsDb> = {}): InvDocsDb {
  return {
    warehouses: [
      warehouse({ id: WH_MAIN, code: 'ANA', name: 'Ana depo', is_default: true }),
      warehouse({ id: WH_SECOND, code: 'SUBE', name: 'Şube deposu' }),
    ],
    locations: [
      {
        id: LOC_A1,
        warehouse_id: WH_MAIN,
        code: 'A-01',
        name: 'Raf A-01',
        is_active: true,
        parent_id: null,
        type: 'shelf',
      },
      {
        id: LOC_A2,
        warehouse_id: WH_MAIN,
        code: 'A-02',
        name: 'Raf A-02',
        is_active: true,
        parent_id: null,
        type: 'shelf',
      },
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
      item({ id: ITEM_NUT, code: 'STK-004', name: 'Somun M8' }),
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
    lots: [
      {
        id: LOT_MILK,
        item_id: ITEM_MILK,
        lot_no: 'L-0925',
        expiry_date: '2026-11-05',
        on_hand: '40.000000',
      },
    ],
    balances: [
      {
        item_id: ITEM_BOLT,
        warehouse_id: WH_MAIN,
        location_id: LOC_A1,
        lot_no: null,
        on_hand: '7.000000',
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
        created_at: '2026-10-15T08:00:00Z',
        version: 2,
        lines: [
          line(DOC_DRAFT, 1, {
            item_id: ITEM_BOLT,
            quantity: '10.000000',
            unit_cost: '2.500000',
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
        number: 'ISS2026000000001',
        status: 'posted',
        document_date: '2026-10-10',
        reason: 'Üretime sarf',
        journal_entry_id: 'je-77',
        posted_at: '2026-10-10T12:00:00Z',
        posted_by: USER_ID,
        created_at: '2026-10-10T11:00:00Z',
        version: 3,
        lines: [
          line(DOC_POSTED, 1, {
            item_id: ITEM_BOLT,
            quantity: '20.000000',
            unit_cost: '2.500000',
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
        created_at: '2026-10-20T07:00:00Z',
        version: 1,
        lines: [
          line(DOC_COUNT, 1, {
            item_id: ITEM_BOLT,
            quantity: '0.000000',
            system_quantity: '100.000000',
            unit_cost: '2.500000',
            location_id: LOC_A1,
          }),
          line(DOC_COUNT, 2, {
            item_id: ITEM_MILK,
            quantity: '0.000000',
            lot_no: 'L-0925',
            system_quantity: '40.000000',
            unit_cost: '30.000000',
            location_id: LOC_A1,
          }),
          line(DOC_COUNT, 3, {
            item_id: ITEM_NUT,
            quantity: '0.000000',
            system_quantity: '5.000000',
            counted_quantity: '5.000000',
            difference: '0.000000',
            unit_cost: '1.000000',
            location_id: LOC_A2,
          }),
        ],
        audit: [],
      },
    ],
    reservations: [
      {
        id: RES_ACTIVE,
        item_id: ITEM_BOLT,
        warehouse_id: WH_MAIN,
        lot_id: null,
        quantity: '12.000000',
        status: 'active',
        source_type: 'sales_order',
        source_id: 'so-1',
        expires_at: '2026-11-01T00:00:00Z',
        closed_at: null,
        notes: 'SIP-2026-000004',
        created_by: USER_ID,
        created_at: '2026-10-18T09:00:00Z',
        updated_at: '2026-10-18T09:00:00Z',
        version: 1,
      },
      {
        id: 'res-2',
        item_id: ITEM_MILK,
        warehouse_id: WH_MAIN,
        lot_id: LOT_MILK,
        quantity: '6.000000',
        status: 'released',
        source_type: 'sales_order',
        source_id: 'so-2',
        expires_at: null,
        closed_at: '2026-10-19T09:00:00Z',
        notes: 'SIP-2026-000005',
        created_by: USER_ID,
        created_at: '2026-10-17T09:00:00Z',
        updated_at: '2026-10-19T09:00:00Z',
        version: 2,
      },
    ],
    reports: defaultReports(),
    reorder: [
      {
        item_id: ITEM_BOLT,
        item_code: 'STK-001',
        item_name: 'Cıvata M8',
        base_unit_id: UNIT_PCS,
        on_hand: '100.000000',
        reserved: '12.000000',
        available: '88.000000',
        reorder_point: '100.000000',
        min_stock: '50.000000',
        suggested_quantity: '62.000000',
      },
    ],
    permissions: [],
    calls: [],
    itemIdBatches: [],
    idempotency: new Map(),
    uploads: [],
    seq: 0,
    numberSeq: {},
    ...overrides,
  }
}

const identity = (over: Record<string, unknown>) => ({
  item_id: null,
  item_code: null,
  item_name: null,
  base_unit_id: null,
  warehouse_id: null,
  warehouse_code: null,
  warehouse_name: null,
  category_id: null,
  category_code: null,
  category_name: null,
  ...over,
})

const bolt = {
  item_id: ITEM_BOLT,
  item_code: 'STK-001',
  item_name: 'Cıvata M8',
  base_unit_id: UNIT_PCS,
}
const milk = {
  item_id: ITEM_MILK,
  item_code: 'STK-002',
  item_name: 'Süt 1L',
  base_unit_id: UNIT_PCS,
}
const main = { warehouse_id: WH_MAIN, warehouse_code: 'ANA', warehouse_name: 'Ana depo' }

function defaultReports(): Record<string, CannedReport> {
  return {
    '/inventory-reports/stock-status': {
      rows: [
        identity({
          ...bolt,
          ...main,
          item_count: 1,
          quantity: '100.000000',
          avg_cost: '2.500000',
          value: '250.0000',
        }),
        identity({
          ...milk,
          ...main,
          item_count: 1,
          quantity: '40.000000',
          avg_cost: '30.000000',
          value: '1200.0000',
        }),
      ],
      meta: { as_of: '2026-10-21', group_by: 'item_warehouse', totals: { value: '1450.0000' } },
    },
    '/inventory-reports/stock-ledger': {
      rows: [
        {
          seq: 11,
          occurred_at: '2026-10-05',
          movement_type: 'receipt',
          direction: 'in',
          ...main,
          location_id: null,
          lot_no: null,
          serial_no: null,
          document_type: 'stock_document',
          document_id: DOC_DRAFT,
          document_number: 'REC2026000000003',
          quantity_in: '70.000000',
          quantity_out: '0.000000',
          unit_cost: '2.500000',
          value_in: '175.0000',
          value_out: '0.0000',
          balance_quantity: '120.000000',
          balance_value: '300.0000',
          balance_avg_cost: '2.500000',
          reverses_id: null,
          movement_id: 'm1',
        },
        {
          seq: 12,
          occurred_at: '2026-10-10',
          movement_type: 'issue',
          direction: 'out',
          ...main,
          location_id: null,
          lot_no: null,
          serial_no: null,
          document_type: 'stock_document',
          document_id: DOC_POSTED,
          document_number: 'ISS2026000000001',
          quantity_in: '0.000000',
          quantity_out: '20.000000',
          unit_cost: '2.500000',
          value_in: '0.0000',
          value_out: '50.0000',
          balance_quantity: '100.000000',
          balance_value: '250.0000',
          balance_avg_cost: '2.500000',
          reverses_id: null,
          movement_id: 'm2',
        },
      ],
      meta: {
        date_from: '2026-10-01',
        date_to: '2026-10-31',
        lines: 2,
        opening: { quantity: '50.000000', value: '125.0000', avg_cost: '2.500000' },
        totals: {
          quantity_in: '70.000000',
          quantity_out: '20.000000',
          value_in: '175.0000',
          value_out: '50.0000',
        },
        closing: { quantity: '100.000000', value: '250.0000', avg_cost: '2.500000' },
        item: { id: ITEM_BOLT, code: 'STK-001', name: 'Cıvata M8', base_unit_id: UNIT_PCS },
        warehouse_id: null,
      },
    },
    '/inventory-reports/valuation': {
      rows: [
        identity({
          ...bolt,
          ...main,
          item_count: 1,
          quantity: '100.000000',
          avg_cost: '2.500000',
          value: '250.0000',
        }),
      ],
      meta: {
        as_of: '2026-09-30',
        group_by: 'item_warehouse',
        method: 'moving_average',
        company_method: 'moving_average',
        basis: 'booked',
        totals: { value: '250.0000' },
      },
    },
    '/inventory-reports/ageing': {
      rows: [
        identity({
          ...bolt,
          ...main,
          quantity: '100.000000',
          value: '250.0000',
          qty_0_30: '70.000000',
          value_0_30: '175.0000',
          qty_31_60: '30.000000',
          value_31_60: '75.0000',
          qty_61_90: '0.000000',
          value_61_90: '0.0000',
          qty_over_90: '0.000000',
          value_over_90: '0.0000',
        }),
      ],
      meta: {
        as_of: '2026-10-21',
        group_by: 'item_warehouse',
        basis: 'receipts',
        method: 'moving_average',
        totals: {
          value: '250.0000',
          value_0_30: '175.0000',
          value_31_60: '75.0000',
          value_61_90: '0.0000',
          value_over_90: '0.0000',
        },
      },
    },
    '/inventory-reports/expiring-lots': {
      rows: [
        {
          lot_id: LOT_MILK,
          lot_no: 'L-0925',
          expiry_date: '2026-11-05',
          days_to_expiry: 15,
          expired: false,
          ...milk,
          ...main,
          on_hand: '40.000000',
          reserved: '0.000000',
          available: '40.000000',
          value: '1200.0000',
        },
      ],
      meta: {
        as_of: '2026-10-21',
        days: 30,
        until: '2026-11-20',
        include_expired: true,
        totals: { lots: 1, expired: 0, value: '1200.0000' },
      },
    },
    '/inventory-reports/abc-analysis': {
      rows: [
        {
          rank: 1,
          class: 'A',
          ...milk,
          category_id: CAT_HW,
          quantity: '300.000000',
          value: '9000.0000',
          share: '90.0000',
          cumulative_share: '90.0000',
        },
        {
          rank: 2,
          class: 'C',
          ...bolt,
          category_id: CAT_HW,
          quantity: '400.000000',
          value: '1000.0000',
          share: '10.0000',
          cumulative_share: '100.0000',
        },
      ],
      meta: {
        date_from: '2026-01-01',
        date_to: '2026-10-21',
        basis: 'consumption',
        thresholds: { a: '80', b: '95' },
        totals: { items: 2, value: '10000.0000', classes: {} },
      },
    },
    '/inventory-reports/turnover': {
      rows: [
        identity({
          ...bolt,
          item_count: 1,
          opening_quantity: '50.000000',
          opening_value: '125.0000',
          closing_quantity: '100.000000',
          closing_value: '250.0001',
          consumed_quantity: '600.000000',
          consumed_value: '1500.0000',
          average_value: '187.50005',
          turnover: '8.0000',
          days_on_hand: '45.6',
        }),
      ],
      meta: {
        date_from: '2026-01-01',
        date_to: '2026-10-21',
        days: 294,
        group_by: 'item',
        totals: {
          opening_value: '125.0000',
          closing_value: '250.0001',
          consumed_value: '1500.0000',
          average_value: '187.50005',
          turnover: '8.0000',
          days_on_hand: '45.6',
        },
      },
    },
    '/inventory-reports/movement-summary': {
      rows: [
        identity({
          ...bolt,
          ...main,
          item_count: 1,
          opening_quantity: '50.000000',
          opening_value: '125.0000',
          in_quantity: '70.000000',
          in_value: '175.0000',
          out_quantity: '20.000000',
          out_value: '50.0000',
          closing_quantity: '100.000000',
          closing_value: '250.0000',
        }),
      ],
      meta: {
        date_from: '2026-01-01',
        date_to: '2026-10-21',
        group_by: 'item_warehouse',
        totals: {
          opening_value: '125.0000',
          in_value: '175.0000',
          out_value: '50.0000',
          closing_value: '250.0000',
        },
        by_type: [],
      },
    },
  }
}

const API = '*/api/v1'
const D = (v: unknown) =>
  new Decimal(typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v) ? v : '0')
/** InventoryRequest::QTY: unsigned, 14 integer and 6 fraction digits. */
const QTY = /^\d{1,14}(\.\d{1,6})?$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown) => (typeof v === 'string' ? v : '')
/** Trimmed text, null when empty (lot numbers). */
const blank = (v: string | null | undefined) => {
  const t = v?.trim() ?? ''
  return t === '' ? null : t
}

function error(status: number, code: string, message: string, fields?: Record<string, string[]>) {
  return HttpResponse.json({ errors: { message, code, ...(fields ? { fields } : {}) } }, { status })
}
const validation = (fields: Record<string, string[]>) =>
  error(422, 'VALIDATION_ERROR', Object.values(fields)[0]?.[0] ?? 'Geçersiz.', fields)
const notFound = () => error(404, 'NOT_FOUND', 'Kayıt bulunamadı.')
const conflict = () =>
  error(409, 'VERSION_CONFLICT', 'Kayıt siz düzenlerken başka biri tarafından değiştirildi.')
const notDraft = () => validation({ document: ['Yalnızca taslak belge değiştirilebilir.'] })

/** ListQuery: page/per_page (≤ 100), sort against an allow-list, unknown filters refused. */
function listQuery(url: URL, sorts: string[], filters: string[]): Response | null {
  const perPage = url.searchParams.get('per_page')
  if (perPage !== null && (!/^\d+$/.test(perPage) || Number(perPage) < 1 || Number(perPage) > 100))
    return validation({ per_page: ['per_page en çok 100 olabilir.'] })
  const sort = url.searchParams.get('sort')
  if (sort?.split(',').some((s) => !sorts.includes(s.replace(/^-/, ''))))
    return validation({ sort: ['Sıralama alanı geçersiz.'] })
  for (const key of url.searchParams.keys()) {
    const m = /^filter\[(.+)\]$/.exec(key)
    if (m && !filters.includes(m[1] ?? ''))
      return validation({ [`filter.${m[1]}`]: ['Geçersiz filtre.'] })
  }
  return null
}

function paginate<T>(rows: T[], url: URL, defaultPerPage = 25, max = 100) {
  const perPage = Math.min(max, Number(url.searchParams.get('per_page') ?? defaultPerPage))
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
  unit_id?: string | null
  quantity?: string
  unit_cost?: string | null
  lot_no?: string | null
  expiry_date?: string | null
  serial_numbers?: string[]
  location_id?: string | null
  target_location_id?: string | null
  direction?: 'in' | 'out' | null
  counted_quantity?: string | null
  notes?: string | null
}

const DOC_TYPES = ['receipt', 'issue', 'transfer', 'count', 'adjustment', 'opening']
const SERIES: Record<string, string> = {
  receipt: 'REC',
  issue: 'ISS',
  transfer: 'TRF',
  count: 'CNT',
  adjustment: 'ADJ',
  opening: 'OPN',
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
  const itemOf = (id: string | undefined | null) => db.items.find((i) => i.id === id)
  const unitOf = (id: string | undefined | null) => db.units.find((u) => u.id === id)
  const withBaseUnit = (it: InvItem) => {
    const u = unitOf(it.base_unit_id)
    return {
      ...it,
      base_unit: u ? { id: u.id, code: u.code, name: u.name, symbol: u.symbol } : null,
    }
  }
  const factorOf = (itemId: string, unitId: string) => {
    const it = itemOf(itemId)
    if (it?.base_unit_id === unitId) return new Decimal(1)
    const alt = db.itemUnits.find((u) => u.item_id === itemId && u.unit_id === unitId)
    return alt ? new Decimal(alt.factor) : null
  }
  const warehouseOf = (id: unknown) => db.warehouses.find((w) => w.id === id)
  const locationIn = (id: string | null | undefined, warehouseId: string | null) =>
    db.locations.some((l) => l.id === id && l.warehouse_id === warehouseId)

  /** StockDocumentRequest rules (shape only; stock rules are checked when posting). */
  function rules(body: Record<string, unknown>, creating: boolean) {
    const fields: Record<string, string[]> = {}
    const req = (k: string) =>
      creating && (body[k] === undefined || body[k] === null || body[k] === '')
    if (req('doc_type') || (body.doc_type !== undefined && !DOC_TYPES.includes(str(body.doc_type))))
      fields.doc_type = ['Belge türü geçersiz.']
    if (
      req('document_date') ||
      (body.document_date !== undefined && !DATE.test(str(body.document_date)))
    )
      fields.document_date = ['Tarih geçersiz.']
    if (req('warehouse_id')) fields.warehouse_id = ['Depo zorunlu.']
    if (creating && body.version !== undefined) fields.version = ['version gönderilmemeli.']
    if (!creating && typeof body.version !== 'number') fields.version = ['version zorunlu.']
    if (!creating && body.freeze !== undefined) fields.freeze = ['freeze yalnızca oluştururken.']
    if (!creating && body.item_ids !== undefined)
      fields.item_ids = ['item_ids yalnızca oluştururken.']
    if (body.allow_expired !== undefined && typeof body.allow_expired !== 'boolean')
      fields.allow_expired = ['allow_expired doğru/yanlış olmalı.']
    if (typeof body.reason === 'string' && body.reason.length > 500)
      fields.reason = ['En çok 500 karakter.']
    if (typeof body.notes === 'string' && body.notes.length > 5000)
      fields.notes = ['En çok 5000 karakter.']
    const lines = body.lines
    if (creating && body.doc_type !== 'count' && !Array.isArray(lines))
      fields.lines = ['Satırlar zorunlu.']
    if (Array.isArray(lines)) {
      if (lines.length > 500) fields.lines = ['En çok 500 satır olabilir.']
      ;(lines as LineBody[]).forEach((l, i) => {
        if (!l.item_id) fields[`lines.${i}.item_id`] = ['Stok kartı zorunlu.']
        for (const k of ['quantity', 'unit_cost', 'counted_quantity'] as const) {
          const v = l[k]
          if (v !== undefined && v !== null && !QTY.test(v))
            fields[`lines.${i}.${k}`] = ['Geçerli bir pozitif miktar girin.']
        }
        if (
          l.direction !== undefined &&
          l.direction !== null &&
          !['in', 'out'].includes(l.direction)
        )
          fields[`lines.${i}.direction`] = ['Yön in veya out olmalı.']
        if (l.expiry_date && !DATE.test(l.expiry_date))
          fields[`lines.${i}.expiry_date`] = ['Tarih geçersiz.']
      })
    }
    return fields
  }

  /** StockDocuments::fill and addLine checks: warehouses, transfer target, items, units, locations. */
  function serviceChecks(
    doc: { doc_type: string; warehouse_id: string; target_warehouse_id: string | null },
    lines: LineBody[],
    prefix = 'lines',
  ) {
    const fields: Record<string, string[]> = {}
    const wh = warehouseOf(doc.warehouse_id)
    if (!wh?.is_active) fields.warehouse_id = ['Depo kullanılamıyor.']
    if (doc.doc_type === 'transfer') {
      const target = warehouseOf(doc.target_warehouse_id)
      if (!doc.target_warehouse_id) fields.target_warehouse_id = ['Transferde hedef depo zorunlu.']
      else if (!target?.is_active) fields.target_warehouse_id = ['Depo kullanılamıyor.']
    }
    lines.forEach((l, i) => {
      const it = itemOf(l.item_id)
      if (!it) fields[`${prefix}.${i}.item_id`] = ['Stok kartı bulunamadı.']
      else if (it.type !== 'stock')
        fields[`${prefix}.${i}.item_id`] = [`${it.code} stoklu bir kart değil.`]
      else if (l.unit_id && !factorOf(it.id, l.unit_id))
        fields[`${prefix}.${i}.unit_id`] = [`${it.code} için birim çevrilemiyor.`]
      if (l.location_id && !locationIn(l.location_id, doc.warehouse_id))
        fields[`${prefix}.${i}.location_id`] = ['Lokasyon bu depoya ait değil.']
      if (l.target_location_id && !locationIn(l.target_location_id, doc.target_warehouse_id))
        fields[`${prefix}.${i}.target_location_id`] = ['Lokasyon hedef depoya ait değil.']
    })
    return fields
  }

  function buildLine(
    docId: string,
    docType: string,
    l: LineBody,
    no: number,
    system: string | null = null,
  ): StockDocumentLine {
    const it = itemOf(l.item_id)
    const unitId = l.unit_id ?? it?.base_unit_id ?? UNIT_PCS
    const factor = factorOf(l.item_id ?? '', unitId) ?? new Decimal(1)
    const qty = D(l.quantity)
    const counted =
      docType === 'count' && l.counted_quantity ? D(l.counted_quantity).toFixed(6) : null
    return line(docId, no, {
      id: `${docId}-l${no}-${db.seq}`,
      item_id: l.item_id ?? '',
      unit_id: unitId,
      quantity: qty.toFixed(6),
      base_quantity: qty.mul(factor).toFixed(6),
      unit_cost: l.unit_cost ? D(l.unit_cost).toFixed(6) : null,
      lot_no: blank(l.lot_no),
      expiry_date: l.expiry_date ?? null,
      serial_numbers: l.serial_numbers ?? [],
      location_id: l.location_id ?? null,
      target_location_id: l.target_location_id ?? null,
      direction: docType === 'adjustment' ? (l.direction ?? 'in') : null,
      system_quantity: docType === 'count' ? (system ?? '0.000000') : null,
      counted_quantity: counted,
      difference: counted === null ? null : D(counted).minus(D(system)).toFixed(6),
      notes: l.notes ?? null,
    })
  }

  const onHand = (warehouseId: string, l: LineBody) =>
    db.balances.find(
      (b) =>
        b.warehouse_id === warehouseId &&
        b.item_id === l.item_id &&
        b.location_id === (l.location_id ?? null) &&
        (b.lot_no ?? null) === blank(l.lot_no),
    )?.on_hand ?? '0.000000'

  /** StockDocuments::addCountLines: one line per balance key; counting a key again updates it. */
  function addCountLines(d: ApiStockDocument, add: LineBody[]) {
    for (const a of add) {
      const lot = blank(a.lot_no)
      const existing = d.lines.find(
        (l) =>
          l.item_id === a.item_id &&
          l.location_id === (a.location_id ?? null) &&
          (l.lot_no ?? null) === lot,
      )
      if (existing) {
        if (a.counted_quantity) {
          existing.counted_quantity = D(a.counted_quantity).toFixed(6)
          existing.difference = D(existing.counted_quantity)
            .minus(D(existing.system_quantity))
            .toFixed(6)
        }
        if (a.unit_cost) existing.unit_cost = D(a.unit_cost).toFixed(6)
        continue
      }
      d.lines.push(buildLine(d.id, 'count', a, d.lines.length + 1, onHand(d.warehouse_id, a)))
    }
  }

  /** Replays an identical retry; a reused key with another body is refused (EnsureIdempotency). */
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
  const resource = (d: ApiStockDocument) => {
    const out: Partial<ApiStockDocument> = { ...d }
    delete out.audit
    return out
  }

  /** StockLedger checks this mock models: count serials, inbound lots, expired lot permission. */
  function postChecks(d: ApiStockDocument): Response | null {
    if (d.allow_expired && !db.permissions.includes('inventory.documents.issue_expired'))
      return error(403, 'FORBIDDEN', 'Süresi geçmiş lottan çıkış yetkiniz yok.')
    const fields: Record<string, string[]> = {}
    d.lines.forEach((l, i) => {
      const it = itemOf(l.item_id)
      if (d.doc_type === 'count') {
        if (it?.tracking === 'serial' && l.counted_quantity !== null)
          fields[`lines.${i}.item_id`] = ['Seri izlemeli kalem sayımla düzeltilemez.']
        return
      }
      const inbound =
        d.doc_type === 'receipt' ||
        d.doc_type === 'opening' ||
        (d.doc_type === 'adjustment' && l.direction !== 'out')
      if (inbound && (it?.tracking === 'lot' || it?.has_expiry) && !l.lot_no)
        fields[`lines.${i}.lot_no`] = ['Lot numarası zorunlu.']
      if (inbound && it?.has_expiry && !l.expiry_date)
        fields[`lines.${i}.expiry_date`] = ['Son kullanma tarihi zorunlu.']
      if ((d.doc_type === 'receipt' || d.doc_type === 'opening') && l.unit_cost === null)
        fields[`lines.${i}.unit_cost`] = ['Birim maliyet zorunlu.']
    })
    return Object.keys(fields).length ? validation(fields) : null
  }

  /** LineImport for count drafts: header row, comma or semicolon, any row error blocks applying. */
  function importCounts(d: ApiStockDocument, text: string) {
    const lines = text.replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), '').split(/\r?\n/)
    const first = lines[0] ?? ''
    const delimiter =
      (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ','
    const header = first.split(delimiter).map((h) => h.trim().toLowerCase())
    if (!header.includes('item_code')) return null
    const rows = lines
      .slice(1)
      .filter((r) => r.trim() !== '')
      .map((r) => {
        const cells = r.split(delimiter)
        return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]))
      })
    const errors: { row: number; field: string; message: string }[] = []
    const parsed: LineBody[] = []
    rows.forEach((row, i) => {
      const before = errors.length
      const no = i + 2
      const it = db.items.find((x) => x.code === row.item_code && x.type === 'stock')
      if (!it)
        errors.push({
          row: no,
          field: 'item_code',
          message: `Stok kartı bulunamadı: ${row.item_code ?? ''}`,
        })
      let location: string | null = null
      if (row.location_code) {
        location =
          db.locations.find(
            (l) => l.warehouse_id === d.warehouse_id && l.code === row.location_code,
          )?.id ?? null
        if (!location)
          errors.push({ row: no, field: 'location_code', message: 'Lokasyon bu depoya ait değil.' })
      }
      if (!QTY.test(row.counted_quantity ?? ''))
        errors.push({ row: no, field: 'counted_quantity', message: 'Miktar geçersiz.' })
      if (errors.length === before && it)
        parsed.push({
          item_id: it.id,
          location_id: location,
          lot_no: blank(row.lot_no),
          counted_quantity: row.counted_quantity,
        })
    })
    return { rows: rows.length, parsed, errors }
  }

  return [
    record,
    // ---- lookups --------------------------------------------------------------------------
    // WarehouseSettingPolicy::viewAny: the pickers' readers.
    http.get(`${API}/stock-warehouses`, () =>
      WAREHOUSE_READERS.some((p) => db.permissions.includes(p))
        ? HttpResponse.json({
            data: [...db.warehouses].sort((a, b) => a.code.localeCompare(b.code)),
          })
        : error(403, 'FORBIDDEN', 'Bu işlem için yetkiniz yok.'),
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
      const type = url.searchParams.get('filter[type]')
      // ItemController: filter[id] is a comma list of at most 100 uuids (422 above).
      const idFilter = url.searchParams.get('filter[id]')
      const ids = idFilter === null ? null : idFilter.split(',')
      if (ids && ids.length > 100) return validation({ 'filter.id': ['En fazla 100 kimlik.'] })
      db.itemIdBatches.push(ids?.length ?? 0)
      const rows = db.items
        .filter((i) => !type || i.type === type)
        .filter((i) => !ids || ids.includes(i.id))
        .filter(
          (i) =>
            has(q, i.code, i.name) ||
            db.barcodes.some((b) => b.item_id === i.id && b.barcode.includes(q.trim())),
        )
        .map(withBaseUnit)
      return HttpResponse.json(paginate(rows, url))
    }),
    http.get(`${API}/items/:id`, ({ params }) => {
      const it = itemOf(String(params.id))
      return it ? HttpResponse.json({ data: withBaseUnit(it) }) : notFound()
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
    http.get(`${API}/stock-lots`, ({ request }) => {
      const url = new URL(request.url)
      const itemId = url.searchParams.get('filter[item_id]')
      return HttpResponse.json(
        paginate(
          db.lots.filter((l) => !itemId || l.item_id === itemId),
          url,
        ),
      )
    }),
    http.get(`${API}/stock-lots/:id`, ({ params }) => {
      const lot = db.lots.find((l) => l.id === params.id)
      return lot ? HttpResponse.json({ data: lot }) : notFound()
    }),
    // ---- stock documents --------------------------------------------------------------------
    http.get(`${API}/stock-documents/export`, ({ request }) => {
      const url = new URL(request.url)
      const format = url.searchParams.get('format') ?? 'csv'
      if (!['csv', 'xlsx'].includes(format)) return validation({ format: ['Biçim geçersiz.'] })
      return new HttpResponse('number,doc_type\n', {
        headers: {
          'Content-Type':
            format === 'xlsx'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : 'text/csv',
          'Content-Disposition': `attachment; filename="stock-documents.${format}"`,
        },
      })
    }),
    http.get(`${API}/stock-documents`, ({ request }) => {
      const url = new URL(request.url)
      const refused = listQuery(
        url,
        ['document_date', 'number', 'created_at', 'posted_at', 'doc_type', 'status'],
        [
          'doc_type',
          'type',
          'status',
          'warehouse_id',
          'target_warehouse_id',
          'source_type',
          'date_from',
          'date_to',
          'item_id',
        ],
      )
      if (refused) return refused
      const f = (k: string) => url.searchParams.get(`filter[${k}]`) ?? ''
      const q = url.searchParams.get('q') ?? ''
      const type = f('doc_type') || f('type')
      const rows = db.documents
        .filter((d) => !type || type.split(',').includes(d.doc_type))
        .filter((d) => !f('status') || f('status').split(',').includes(d.status))
        .filter((d) => !f('warehouse_id') || d.warehouse_id === f('warehouse_id'))
        .filter((d) => !f('item_id') || d.lines.some((l) => l.item_id === f('item_id')))
        .filter((d) => !f('date_from') || d.document_date >= f('date_from'))
        .filter((d) => !f('date_to') || d.document_date <= f('date_to'))
        .filter((d) => has(q, d.number, d.reason, d.notes))
        .sort((a, b) => b.document_date.localeCompare(a.document_date))
      return HttpResponse.json(paginate(rows.map(summary), url))
    }),
    http.get(`${API}/stock-documents/:id`, ({ params }) => {
      const d = find(String(params.id))
      return d ? HttpResponse.json({ data: { ...resource(d), audit: d.audit ?? [] } }) : notFound()
    }),
    http.post(`${API}/stock-documents`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      return idempotent(request, body, () => {
        const shape = rules(body, true)
        if (Object.keys(shape).length) return validation(shape)
        const docType = String(body.doc_type)
        const lines = (Array.isArray(body.lines) ? body.lines : []) as LineBody[]
        const head = {
          doc_type: docType,
          warehouse_id: String(body.warehouse_id),
          target_warehouse_id:
            docType === 'transfer' ? ((body.target_warehouse_id as string | null) ?? null) : null,
        }
        const checks = serviceChecks(head, lines, docType === 'count' ? 'add' : 'lines')
        if (Object.keys(checks).length) return validation(checks)
        db.seq += 1
        const id = `sd-new-${db.seq}`
        const doc: ApiStockDocument = {
          ...baseDoc,
          id,
          doc_type: docType as ApiStockDocument['doc_type'],
          number: null,
          status: 'draft',
          document_date: String(body.document_date),
          warehouse_id: head.warehouse_id,
          target_warehouse_id: head.target_warehouse_id,
          reason: (body.reason as string | null) ?? null,
          notes: (body.notes as string | null) ?? null,
          offset_event: (body.offset_event as string | null) ?? null,
          allow_expired: body.allow_expired === true,
          frozen_at: docType === 'count' ? '2026-10-21T09:00:00Z' : null,
          created_at: '2026-10-21T09:00:00Z',
          version: 1,
          lines: [],
          audit: [
            {
              event: 'created',
              description: 'created',
              causer_id: USER_ID,
              created_at: '2026-10-21T09:00:00Z',
            },
          ],
        }
        if (docType === 'count') {
          if (body.freeze !== false) {
            const only = Array.isArray(body.item_ids) ? (body.item_ids as string[]) : []
            db.balances
              .filter((b) => b.warehouse_id === doc.warehouse_id && !D(b.on_hand).isZero())
              .filter((b) => only.length === 0 || only.includes(b.item_id))
              .forEach((b, i) => {
                doc.lines.push(
                  buildLine(
                    id,
                    'count',
                    {
                      item_id: b.item_id,
                      location_id: b.location_id,
                      lot_no: b.lot_no,
                      quantity: '0',
                    },
                    i + 1,
                    D(b.on_hand).toFixed(6),
                  ),
                )
              })
          }
          addCountLines(doc, lines)
        } else {
          doc.lines = lines.map((l, i) => buildLine(id, docType, l, i + 1))
        }
        db.documents.unshift(doc)
        return { status: 201, body: { data: resource(doc) } }
      })
    }),
    http.patch(`${API}/stock-documents/:id/counts`, async ({ request, params }) => {
      const d = find(String(params.id))
      if (!d) return notFound()
      const body = (await request.json()) as { version?: unknown; counts?: unknown; add?: unknown }
      const fields: Record<string, string[]> = {}
      if (typeof body.version !== 'number') fields.version = ['version zorunlu.']
      const counts = (Array.isArray(body.counts) ? body.counts : []) as {
        line_id?: string
        counted_quantity?: string | null
      }[]
      const add = (Array.isArray(body.add) ? body.add : []) as LineBody[]
      counts.forEach((c, i) => {
        if (!c.line_id) fields[`counts.${i}.line_id`] = ['Satır zorunlu.']
        if (!('counted_quantity' in c))
          fields[`counts.${i}.counted_quantity`] = ['Alan gönderilmeli.']
        else if (c.counted_quantity !== null && !QTY.test(String(c.counted_quantity)))
          fields[`counts.${i}.counted_quantity`] = ['Miktar geçersiz.']
      })
      add.forEach((a, i) => {
        if (!a.item_id) fields[`add.${i}.item_id`] = ['Stok kartı zorunlu.']
        if (a.counted_quantity && !QTY.test(a.counted_quantity))
          fields[`add.${i}.counted_quantity`] = ['Miktar geçersiz.']
      })
      if (Object.keys(fields).length) return validation(fields)
      if (body.version !== d.version) return conflict()
      if (d.status !== 'draft') return notDraft()
      if (d.doc_type !== 'count') return validation({ document: ['Belge bir sayım değil.'] })
      for (const [i, c] of counts.entries()) {
        if (!d.lines.some((l) => l.id === c.line_id))
          return validation({ [`counts.${i}.line_id`]: ['Satır bulunamadı.'] })
      }
      const checks = serviceChecks(d, add, 'add')
      if (Object.keys(checks).length) return validation(checks)
      for (const c of counts) {
        const l = d.lines.find((x) => x.id === c.line_id)
        if (!l) continue
        l.counted_quantity = c.counted_quantity == null ? null : D(c.counted_quantity).toFixed(6)
        l.difference =
          l.counted_quantity === null
            ? null
            : D(l.counted_quantity).minus(D(l.system_quantity)).toFixed(6)
      }
      addCountLines(d, add)
      d.version += 1
      return HttpResponse.json({ data: resource(d) })
    }),
    http.patch(`${API}/stock-documents/:id`, async ({ request, params }) => {
      const d = find(String(params.id))
      if (!d) return notFound()
      const body = (await request.json()) as Record<string, unknown>
      const shape = rules(body, false)
      if (Object.keys(shape).length) return validation(shape)
      if (body.version !== d.version) return conflict()
      if (d.status !== 'draft') return notDraft()
      if (body.doc_type !== undefined && body.doc_type !== d.doc_type)
        return validation({ doc_type: ['Belge türü değiştirilemez.'] })
      if (d.doc_type === 'count' && body.lines !== undefined)
        return validation({ lines: ['Sayım satırları /counts ile değişir.'] })
      const head = {
        doc_type: d.doc_type,
        warehouse_id: (body.warehouse_id as string | undefined) ?? d.warehouse_id,
        target_warehouse_id:
          d.doc_type === 'transfer'
            ? ((body.target_warehouse_id as string | null | undefined) ?? d.target_warehouse_id)
            : null,
      }
      const lines = Array.isArray(body.lines) ? (body.lines as LineBody[]) : null
      const checks = serviceChecks(head, lines ?? [])
      if (Object.keys(checks).length) return validation(checks)
      Object.assign(d, head, {
        document_date: (body.document_date as string | undefined) ?? d.document_date,
        reason: body.reason !== undefined ? (body.reason as string | null) : d.reason,
        notes: body.notes !== undefined ? (body.notes as string | null) : d.notes,
        allow_expired:
          body.allow_expired !== undefined ? body.allow_expired === true : d.allow_expired,
      })
      if (lines) d.lines = lines.map((l, i) => buildLine(d.id, d.doc_type, l, i + 1))
      d.version += 1
      return HttpResponse.json({ data: resource(d) })
    }),
    http.delete(`${API}/stock-documents/:id`, ({ request, params }) => {
      const d = find(String(params.id))
      if (!d) return notFound()
      const raw = new URL(request.url).searchParams.get('version')
      if (raw !== null && !/^\d+$/.test(raw))
        return validation({ version: ['version tam sayı olmalı.'] })
      if (raw !== null && Number(raw) !== d.version) return conflict()
      if (d.status !== 'draft') return notDraft()
      db.documents = db.documents.filter((x) => x.id !== d.id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/stock-documents/:id/import`, async ({ request, params }) => {
      const d = find(String(params.id))
      if (!d) return notFound()
      const form = await request.formData()
      const file = form.get('file')
      const flag = form.get('dry_run')
      const dryRun = typeof flag === 'string' ? flag : ''
      const version = form.get('version')
      // jsdom and Node each have their own File class: check the shape, not the constructor.
      if (file === null || typeof file === 'string') return validation({ file: ['Dosya zorunlu.'] })
      if (!/\.(csv|txt)$/i.test(file.name)) return validation({ file: ['Yalnızca csv veya txt.'] })
      if (file.size > 5120 * 1024) return validation({ file: ['Dosya en çok 5 MB olabilir.'] })
      if (d.doc_type !== 'count' && d.doc_type !== 'opening')
        return validation({ file: ['Bu belge türüne içe aktarma yapılamaz.'] })
      if (d.status !== 'draft') return notDraft()
      const text = await file.text()
      db.uploads.push({ name: file.name, text, dryRun })
      const out = importCounts(d, text)
      if (!out) return validation({ file: ['Başlık satırında item_code yok.'] })
      const result = {
        rows: out.rows,
        valid: out.parsed.length,
        errors: out.errors,
        applied: false,
      }
      if (dryRun === '1' || out.errors.length > 0 || out.parsed.length === 0)
        return HttpResponse.json({ data: result })
      if (typeof version === 'string' && Number(version) !== d.version) return conflict()
      addCountLines(d, out.parsed)
      d.version += 1
      return HttpResponse.json({ data: { ...result, applied: true } })
    }),
    http.post(`${API}/stock-documents/:id/post`, async ({ request, params }) => {
      const d = find(String(params.id))
      if (!d) return notFound()
      const body = (await request.json().catch(() => ({}))) as { version?: number }
      return idempotent(request, { id: d.id, ...body }, () => {
        if (body.version !== undefined && body.version !== d.version) return conflict()
        if (d.status !== 'draft') return notDraft()
        const refused = postChecks(d)
        if (refused) return refused
        const n = (db.numberSeq[d.doc_type] ?? 0) + 1
        db.numberSeq[d.doc_type] = n
        d.number = `${SERIES[d.doc_type] ?? 'DOC'}2026${String(n).padStart(9, '0')}`
        d.status = 'posted'
        d.posted_at = '2026-10-21T10:00:00Z'
        d.posted_by = USER_ID
        d.journal_entry_id = d.doc_type === 'transfer' ? null : `je-${d.id}`
        d.version += 1
        return { status: 200, body: { data: resource(d) } }
      })
    }),
    http.post(`${API}/stock-documents/:id/reverse`, async ({ request, params }) => {
      const d = find(String(params.id))
      if (!d) return notFound()
      const body = (await request.json()) as { date?: string; reason?: string; version?: number }
      return idempotent(request, { id: d.id, ...body }, () => {
        const fields: Record<string, string[]> = {}
        if (!body.date || !DATE.test(body.date)) fields.date = ['Tarih zorunlu.']
        if (!body.reason) fields.reason = ['Gerekçe zorunlu.']
        else if (body.reason.length > 1000) fields.reason = ['En çok 1000 karakter.']
        if (Object.keys(fields).length) return validation(fields)
        if (body.version !== undefined && body.version !== d.version) return conflict()
        if (d.status !== 'posted')
          return validation({ document: ['Yalnızca kesinleşmiş belge ters kayda alınır.'] })
        if ((body.date ?? '') < d.document_date)
          return validation({ date: ['Tarih belge tarihinden önce olamaz.'] })
        d.status = 'cancelled'
        d.reversal_date = body.date ?? null
        d.reversal_reason = body.reason ?? null
        d.reversal_journal_entry_id = d.journal_entry_id ? `${d.journal_entry_id}-r` : null
        d.reversed_at = '2026-10-21T11:00:00Z'
        d.reversed_by = USER_ID
        d.version += 1
        return { status: 200, body: { data: resource(d) } }
      })
    }),
    // ---- reservations -----------------------------------------------------------------------
    http.get(`${API}/stock-reservations`, ({ request }) => {
      const url = new URL(request.url)
      const refused = listQuery(
        url,
        ['created_at', 'expires_at', 'quantity', 'status'],
        ['status', 'item_id', 'warehouse_id', 'lot_id', 'source_type', 'source_id'],
      )
      if (refused) return refused
      const f = (k: string) => url.searchParams.get(`filter[${k}]`) ?? ''
      const q = url.searchParams.get('q') ?? ''
      const rows = db.reservations
        .filter((r) => !f('status') || f('status').split(',').includes(r.status))
        .filter((r) => !f('warehouse_id') || r.warehouse_id === f('warehouse_id'))
        .filter((r) => !f('item_id') || r.item_id === f('item_id'))
        .filter((r) => !f('lot_id') || r.lot_id === f('lot_id'))
        .filter((r) => has(q, r.notes))
      return HttpResponse.json(paginate(rows, url))
    }),
    http.post(`${API}/stock-reservations`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      return idempotent(request, body, () => {
        const fields: Record<string, string[]> = {}
        if (!body.item_id) fields.item_id = ['Stok kartı zorunlu.']
        if (!body.warehouse_id) fields.warehouse_id = ['Depo zorunlu.']
        if (typeof body.quantity !== 'string' || !QTY.test(body.quantity))
          fields.quantity = ['Miktar geçersiz.']
        if (Boolean(body.source_type) !== Boolean(body.source_id))
          fields.source_id = ['Kaynak türü ve kimliği birlikte.']
        if (typeof body.notes === 'string' && body.notes.length > 500)
          fields.notes = ['En çok 500 karakter.']
        if (Object.keys(fields).length) return validation(fields)
        const wh = warehouseOf(body.warehouse_id)
        if (wh?.reservation_policy === 'none')
          return validation({ warehouse_id: ['Bu depoda rezervasyon yapılamaz.'] })
        db.seq += 1
        const r: StockReservation = {
          id: `res-new-${db.seq}`,
          item_id: String(body.item_id),
          warehouse_id: String(body.warehouse_id),
          lot_id: (body.lot_id as string | null) ?? null,
          quantity: D(body.quantity).toFixed(6),
          status: 'active',
          source_type: (body.source_type as string | null) ?? null,
          source_id: (body.source_id as string | null) ?? null,
          expires_at: str(body.expires_at) ? `${str(body.expires_at)}T00:00:00Z` : null,
          closed_at: null,
          notes: (body.notes as string | null) ?? null,
          created_by: USER_ID,
          created_at: '2026-10-21T09:00:00Z',
          updated_at: '2026-10-21T09:00:00Z',
          version: 1,
        }
        db.reservations.unshift(r)
        const available = db.balances
          .filter((b) => b.item_id === r.item_id && b.warehouse_id === r.warehouse_id)
          .reduce((s, b) => s.plus(D(b.on_hand)), new Decimal(0))
        const shortage = Decimal.max(0, D(r.quantity).minus(available)).toFixed(6)
        return { status: 201, body: { data: r, meta: { shortage, replayed: false } } }
      })
    }),
    http.post(`${API}/stock-reservations/:id/release`, async ({ request, params }) => {
      const r = db.reservations.find((x) => x.id === params.id)
      if (!r) return notFound()
      const body = (await request.json().catch(() => ({}))) as { version?: number }
      return idempotent(request, { id: r.id, ...body }, () => {
        if (body.version !== undefined && body.version !== r.version) return conflict()
        if (r.status !== 'active') return validation({ reservation: ['Rezervasyon etkin değil.'] })
        r.status = 'released'
        r.closed_at = '2026-10-21T10:00:00Z'
        r.version += 1
        return { status: 200, body: { data: r } }
      })
    }),
    // ---- reports ----------------------------------------------------------------------------
    http.get(`${API}/inventory-reports/:name/export`, ({ request, params }) => {
      const format = new URL(request.url).searchParams.get('format') ?? 'csv'
      if (!['csv', 'xlsx'].includes(format)) return validation({ format: ['Biçim geçersiz.'] })
      return new HttpResponse('a,b\n', {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${String(params.name)}.${format}"`,
        },
      })
    }),
    http.get(`${API}/inventory-reports/:name`, ({ request, params }) => {
      const url = new URL(request.url)
      const p = (k: string) => url.searchParams.get(k)
      const fields: Record<string, string[]> = {}
      for (const k of ['as_of', 'date_from', 'date_to']) {
        const v = p(k)
        if (v && !DATE.test(v)) fields[k] = ['Tarih Y-m-d olmalı.']
      }
      const dateFrom = p('date_from')
      const dateTo = p('date_to')
      if (dateFrom && dateTo && dateTo < dateFrom)
        fields.date_to = ['Bitiş başlangıçtan önce olamaz.']
      const perPage = p('per_page')
      if (perPage && (Number(perPage) < 1 || Number(perPage) > 500))
        fields.per_page = ['En çok 500.']
      const group = p('group_by')
      if (group && !['item_warehouse', 'item', 'warehouse', 'category'].includes(group))
        fields.group_by = ['Gruplama geçersiz.']
      for (const k of ['include_zero', 'include_expired']) {
        const v = p(k)
        if (v !== null && !['0', '1', 'true', 'false'].includes(v)) fields[k] = ['Geçersiz.']
      }
      if (params.name === 'stock-ledger' && !p('item_id')) fields.item_id = ['Stok kartı zorunlu.']
      if (Object.keys(fields).length) return validation(fields)
      const report = db.reports[`/inventory-reports/${String(params.name)}`]
      if (!report) return notFound()
      const page = paginate(report.rows, url, 100, 500)
      return HttpResponse.json({
        data: page.data,
        meta: { ...report.meta, pagination: page.meta.pagination },
      })
    }),
    http.get(`${API}/reports/reorder-suggestions`, ({ request }) => {
      const q = new URL(request.url).searchParams.get('q') ?? ''
      return HttpResponse.json({
        data: db.reorder.filter((r) => has(q, String(r.item_code), String(r.item_name))),
      })
    }),
  ]
}
