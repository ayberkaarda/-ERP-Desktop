import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import { validateBarcode } from '@/features/catalog/lib/barcode'
import { descendantIds } from '@/features/catalog/lib/tree'
import type {
  CurrencyRef,
  DiscountRule,
  Item,
  ItemBarcode,
  ItemCategory,
  ItemUnit,
  ItemVariant,
  PartyRef,
  PriceList,
  PriceListLine,
  TaxCodeRef,
  Unit,
  UnitConversion,
} from '@/features/catalog/types'

// In-memory stand-in for the Catalog API (PHASE2 "Catalog module endpoints") plus the
// read-only lookups it uses from Reference and Parties.

export interface CatalogDb {
  units: Unit[]
  conversions: UnitConversion[]
  categories: ItemCategory[]
  items: Item[]
  variants: ItemVariant[]
  barcodes: ItemBarcode[]
  itemUnits: ItemUnit[]
  priceLists: PriceList[]
  lines: Record<string, PriceListLine[]>
  discountRules: DiscountRule[]
  taxCodes: TaxCodeRef[]
  currencies: CurrencyRef[]
  parties: (PartyRef & { price_list_id?: string | null })[]
  calls: { method: string; path: string; body: unknown; headers: Headers; url: URL }[]
  seq: number
}

export const U_PCS = 'unit-pcs'
export const U_BOX = 'unit-box'
export const U_KG = 'unit-kg'
export const U_G = 'unit-g'
export const ITEM_BOLT = 'item-bolt'
export const ITEM_SERVICE = 'item-service'
export const PL_DEFAULT = 'pl-default'
export const PL_DEALER = 'pl-dealer'
export const PARTY_DEALER = 'party-dealer'
export const TAX_KDV20 = 'tax-kdv20'

const unit = (id: string, code: string, name: string, symbol: string | null): Unit => ({
  id,
  code,
  name,
  symbol,
  is_active: true,
  version: 1,
})

const baseItem = (over: Partial<Item> & Pick<Item, 'id' | 'code' | 'name'>): Item => ({
  type: 'stock',
  base_unit_id: U_PCS,
  category_id: null,
  default_tax_code_id: TAX_KDV20,
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

export function createCatalogDb(overrides: Partial<CatalogDb> = {}): CatalogDb {
  return {
    units: [
      unit(U_PCS, 'ADET', 'Adet', 'ad'),
      unit(U_BOX, 'KOLI', 'Koli', 'kl'),
      unit(U_KG, 'KG', 'Kilogram', 'kg'),
      unit(U_G, 'GR', 'Gram', 'g'),
    ],
    conversions: [
      { id: 'conv-kg-g', from_unit_id: U_KG, to_unit_id: U_G, factor: '1000.000000', version: 1 },
    ],
    categories: [
      { id: 'cat-root', code: 'HM', name: 'Hammadde', parent_id: null, version: 1 },
      { id: 'cat-metal', code: 'HM.01', name: 'Metal', parent_id: 'cat-root', version: 1 },
      {
        id: 'cat-fastener',
        code: 'HM.01.01',
        name: 'Bağlantı',
        parent_id: 'cat-metal',
        version: 1,
      },
      { id: 'cat-service', code: 'HZ', name: 'Hizmet', parent_id: null, version: 1 },
    ],
    items: [
      baseItem({
        id: ITEM_BOLT,
        code: 'STK000001',
        name: 'Cıvata M8',
        category_id: 'cat-fastener',
        tracking: 'lot',
        attributes: { malzeme: 'çelik' },
      }),
      baseItem({
        id: ITEM_SERVICE,
        code: 'STK000002',
        name: 'Montaj hizmeti',
        type: 'service',
        category_id: 'cat-service',
      }),
    ],
    variants: [
      {
        id: 'var-zinc',
        item_id: ITEM_BOLT,
        sku: 'CVT-M8-ZN',
        attributes: { kaplama: 'çinko' },
        is_active: true,
        version: 1,
      },
    ],
    barcodes: [
      {
        id: 'bc-1',
        item_id: ITEM_BOLT,
        barcode: '4006381333931',
        type: 'ean13',
        unit_id: U_PCS,
        variant_id: null,
        is_primary: true,
        version: 1,
      },
    ],
    itemUnits: [
      { id: 'iu-box', item_id: ITEM_BOLT, unit_id: U_BOX, factor: '12.000000', version: 1 },
    ],
    priceLists: [
      {
        id: PL_DEFAULT,
        code: 'GENEL',
        name: 'Genel liste',
        currency_code: 'TRY',
        is_default: true,
        valid_from: null,
        valid_to: null,
        is_active: true,
        tax_inclusive: false,
        version: 1,
      },
      {
        id: PL_DEALER,
        code: 'BAYI',
        name: 'Bayi listesi',
        currency_code: 'TRY',
        is_default: false,
        valid_from: '2026-01-01',
        valid_to: null,
        is_active: true,
        tax_inclusive: false,
        version: 1,
      },
    ],
    lines: {
      [PL_DEFAULT]: [
        line('pll-1', ITEM_BOLT, '1', '12.500000'),
        line('pll-2', ITEM_BOLT, '100', '11.000000'),
      ],
      [PL_DEALER]: [line('pll-3', ITEM_BOLT, '1', '10.000000')],
    },
    discountRules: [
      {
        id: 'dr-1',
        code: 'IND10',
        name: 'Bağlantı elemanı indirimi',
        scope: 'category',
        scope_ref: 'cat-fastener',
        party_id: null,
        min_qty: '50',
        discount_percent: '10.0000',
        priority: 10,
        valid_from: null,
        valid_to: null,
        is_active: true,
        stackable: false,
        version: 1,
      },
    ],
    taxCodes: [
      { id: TAX_KDV20, code: 'KDV20', name: 'KDV %20', rate: '20.0000', type: 'vat' },
      { id: 'tax-kdv10', code: 'KDV10', name: 'KDV %10', rate: '10.0000', type: 'vat' },
    ],
    currencies: [
      { code: 'TRY', name: 'Türk lirası' },
      { code: 'USD', name: 'ABD doları' },
      { code: 'EUR', name: 'Euro' },
    ],
    parties: [
      { id: PARTY_DEALER, code: 'P000001', name: 'Ege Bayi Ltd.', price_list_id: PL_DEALER },
      { id: 'party-retail', code: 'P000002', name: 'Perakende Müşteri', price_list_id: null },
    ],
    calls: [],
    seq: 0,
    ...overrides,
  }
}

function line(id: string, itemId: string, minQty: string, price: string): PriceListLine {
  return {
    id,
    item_id: itemId,
    variant_id: null,
    unit_id: U_PCS,
    min_qty: minQty,
    price,
    valid_from: null,
    valid_to: null,
    version: 1,
  }
}

type Row = Record<string, unknown>
const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
type Fields = Record<string, string[]> | null

const API = '*/api/v1'

function error(status: number, code: string, message: string, fields?: Record<string, string[]>) {
  return HttpResponse.json({ errors: { message, code, ...(fields ? { fields } : {}) } }, { status })
}

const validation = (fields: Record<string, string[]>) =>
  error(422, 'VALIDATION_FAILED', 'Gönderilen bilgiler geçersiz.', fields)
const notFound = () => error(404, 'NOT_FOUND', 'Kayıt bulunamadı.')
const conflict = () =>
  error(409, 'VERSION_CONFLICT', 'Kayıt siz düzenlerken başka biri tarafından değiştirildi.')

/**
 * The list contract of one endpoint, copied from the backend controller: allowed sort fields,
 * plain column filters, and filters with their own semantics. Anything else is a 422 there.
 */
export interface ListContract<T> {
  sorts: string[]
  filters: string[]
  custom?: Record<string, (row: T, value: string) => boolean>
}

function paginate<T extends object>(
  rows: T[],
  url: URL,
  searchable: string[],
  extra?: (q: string, r: T) => boolean,
  contract?: ListContract<T>,
) {
  let out = [...rows]
  for (const [key, value] of url.searchParams) {
    const name = /^filter\[(.+)\]$/.exec(key)?.[1]
    if (!name) continue
    const custom = contract?.custom?.[name]
    if (contract && !custom && !contract.filters.includes(name))
      return validation({ [`filter.${name}`]: ['Geçersiz filtre.'] })
    if (value === '') continue
    const values = value.split(',')
    out = custom
      ? out.filter((r) => custom(r, value))
      : out.filter((r) => values.includes(String((r as Row)[name])))
  }
  const q = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase('tr')
  if (q) {
    out = out.filter(
      (r) =>
        searchable.some((f) => {
          const v = (r as Row)[f]
          return typeof v === 'string' && v.toLocaleLowerCase('tr').includes(q)
        }) ||
        (extra?.(q, r) ?? false),
    )
  }
  const sort = url.searchParams.get('sort')
  if (sort && contract) {
    const bad = sort.split(',').find((s) => s && !contract.sorts.includes(s.replace(/^-/, '')))
    if (bad !== undefined) return validation({ sort: ['Geçersiz sıralama.'] })
  }
  if (sort) {
    const desc = sort.startsWith('-')
    const field = (desc ? sort.slice(1) : sort).split(',')[0] ?? ''
    out.sort((a, b) => {
      const av = text((a as Row)[field])
      const bv = text((b as Row)[field])
      return desc ? bv.localeCompare(av, 'tr') : av.localeCompare(bv, 'tr')
    })
  }
  const perPage = Math.min(100, Number(url.searchParams.get('per_page') ?? 25))
  const page = Number(url.searchParams.get('page') ?? 1)
  const total = out.length
  return HttpResponse.json({
    data: out.slice((page - 1) * perPage, page * perPage),
    meta: {
      pagination: {
        total,
        current_page: page,
        per_page: perPage,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    },
  })
}

const isPositive = (v: unknown) =>
  typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v) && new Decimal(v).greaterThan(0)
const isNonNegative = (v: unknown) => typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v)
const blank = (v: unknown) => typeof v !== 'string' || v.trim() === ''

interface ResourceSpec<T extends { id: string }> {
  path: string
  rows: () => T[]
  searchable: string[]
  create: (body: Row, db: CatalogDb) => T | Response
  validate?: (body: Row, existing: T | null, db: CatalogDb) => Record<string, string[]> | null
  versioned?: boolean
  search?: (q: string, row: T) => boolean
  list: ListContract<T>
  /** Fields the request rejects on PATCH ('prohibited' rule). */
  immutable?: string[]
}

function prohibited(body: Row, fields: readonly string[] | undefined) {
  const hit = (fields ?? []).filter((f) => f in body)
  return hit.length
    ? validation(Object.fromEntries(hit.map((f) => [f, ['Değiştirilemez.']])))
    : null
}

function resource<T extends { id: string; version?: number }>(
  db: CatalogDb,
  spec: ResourceSpec<T>,
) {
  const find = (id: string) => spec.rows().find((r) => r.id === id) ?? null
  return [
    http.get(`${API}${spec.path}`, ({ request }) =>
      paginate(spec.rows(), new URL(request.url), spec.searchable, spec.search, spec.list),
    ),
    http.get(`${API}${spec.path}/:id`, ({ params }) => {
      const row = find(String(params.id))
      return row ? HttpResponse.json({ data: row }) : notFound()
    }),
    http.post(`${API}${spec.path}`, async ({ request }) => {
      if (!request.headers.get('Idempotency-Key'))
        return error(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key gerekli.')
      const body = (await request.json()) as Row
      const problems = spec.validate?.(body, null, db)
      if (problems) return validation(problems)
      const created = spec.create(body, db)
      if (created instanceof Response) return created
      spec.rows().push(created)
      return HttpResponse.json({ data: created }, { status: 201 })
    }),
    http.patch(`${API}${spec.path}/:id`, async ({ params, request }) => {
      const row = find(String(params.id))
      if (!row) return notFound()
      const body = (await request.json()) as Row
      const locked = prohibited(body, spec.immutable)
      if (locked) return locked
      if (spec.versioned !== false && body.version !== row.version) return conflict()
      const problems = spec.validate?.({ ...row, ...body }, row, db)
      if (problems) return validation(problems)
      const rest = { ...body }
      delete rest.version
      Object.assign(row, rest)
      if (typeof row.version === 'number') row.version += 1
      return HttpResponse.json({ data: row })
    }),
    http.delete(`${API}${spec.path}/:id`, ({ params }) => {
      const rows = spec.rows()
      const idx = rows.findIndex((r) => r.id === String(params.id))
      if (idx < 0) return notFound()
      rows.splice(idx, 1)
      return new HttpResponse(null, { status: 204 })
    }),
  ]
}

const LINE_KEYS = [
  'item_id',
  'variant_id',
  'unit_id',
  'min_qty',
  'price',
  'valid_from',
  'valid_to',
  'version',
]

/** PriceLineRules::key: (item, variant, unit, min_qty at scale 6, valid_from). */
function naturalKey(l: Row): string {
  const min = new Decimal(text(l.min_qty) || '0').toFixed(6)
  return [text(l.item_id), text(l.variant_id), text(l.unit_id), min, text(l.valid_from)].join('|')
}

function nextId(db: CatalogDb, prefix: string) {
  db.seq += 1
  return `${prefix}-new-${db.seq}`
}

function uniqueCode<T extends { id: string; code: string }>(
  rows: T[],
  body: Row,
  existing: T | null,
) {
  return rows.some((r) => r.code === body.code && r.id !== existing?.id)
}

export function catalogHandlers(db: CatalogDb) {
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

  const itemChild = <T extends { id: string; item_id: string; version?: number }>(
    path: string,
    rows: () => T[],
    make: (itemId: string, body: Row) => T,
    validate: (body: Row, existing: T | null, itemId: string) => Record<string, string[]> | null,
    list: ListContract<T>,
  ) => [
    http.get(`${API}/items/:item/${path}`, ({ params, request }) =>
      paginate(
        rows().filter((r) => r.item_id === String(params.item)),
        new URL(request.url),
        [],
        undefined,
        list,
      ),
    ),
    http.post(`${API}/items/:item/${path}`, async ({ params, request }) => {
      if (!request.headers.get('Idempotency-Key'))
        return error(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key gerekli.')
      const body = (await request.json()) as Row
      const problems = validate(body, null, String(params.item))
      if (problems) return validation(problems)
      const row = make(String(params.item), body)
      rows().push(row)
      return HttpResponse.json({ data: row }, { status: 201 })
    }),
    http.patch(`${API}/items/:item/${path}/:id`, async ({ params, request }) => {
      const row = rows().find((r) => r.id === String(params.id))
      if (!row) return notFound()
      const body = (await request.json()) as Row
      const locked = prohibited(body, path === 'units' ? ['unit_id'] : [])
      if (locked) return locked
      if (typeof row.version === 'number' && body.version === undefined)
        return validation({ version: ['Sürüm zorunludur.'] })
      if (typeof row.version === 'number' && body.version !== row.version) return conflict()
      const problems = validate({ ...row, ...body }, row, String(params.item))
      if (problems) return validation(problems)
      const rest = { ...body }
      delete rest.version
      Object.assign(row, rest)
      if (typeof row.version === 'number') row.version += 1
      return HttpResponse.json({ data: row })
    }),
    http.delete(`${API}/items/:item/${path}/:id`, ({ params }) => {
      const list = rows()
      const idx = list.findIndex((r) => r.id === String(params.id))
      if (idx < 0) return notFound()
      list.splice(idx, 1)
      return new HttpResponse(null, { status: 204 })
    }),
  ]

  return [
    record,
    ...resource<Unit>(db, {
      path: '/units',
      rows: () => db.units,
      searchable: ['code', 'name', 'symbol'],
      list: { sorts: ['code', 'name', 'created_at'], filters: ['is_active'] },
      validate: (b, existing): Fields => {
        if (blank(b.code)) return { code: ['Kod zorunludur.'] }
        if (uniqueCode(db.units, b, existing)) return { code: ['Bu kod zaten kullanılıyor.'] }
        if (blank(b.name)) return { name: ['Ad zorunludur.'] }
        return null
      },
      create: (b) => ({
        id: nextId(db, 'unit'),
        code: String(b.code),
        name: String(b.name),
        symbol: (b.symbol as string | null) ?? null,
        is_active: b.is_active !== false,
        version: 1,
      }),
    }),
    ...resource<UnitConversion>(db, {
      path: '/unit-conversions',
      rows: () => db.conversions,
      searchable: [],
      immutable: ['from_unit_id', 'to_unit_id'],
      list: {
        sorts: ['created_at'],
        filters: ['from_unit_id', 'to_unit_id'],
        custom: { unit_id: (c, v) => c.from_unit_id === v || c.to_unit_id === v },
      },
      validate: (b, existing): Fields => {
        if (!isPositive(b.factor)) return { factor: ['Çarpan sıfırdan büyük olmalıdır.'] }
        if (b.from_unit_id === b.to_unit_id) return { to_unit_id: ['Birimler farklı olmalıdır.'] }
        const dup = db.conversions.some(
          (c) =>
            c.id !== existing?.id &&
            c.from_unit_id === b.from_unit_id &&
            c.to_unit_id === b.to_unit_id,
        )
        return dup ? { to_unit_id: ['Bu dönüşüm zaten tanımlı.'] } : null
      },
      create: (b) => ({
        id: nextId(db, 'conv'),
        from_unit_id: String(b.from_unit_id),
        to_unit_id: String(b.to_unit_id),
        factor: String(b.factor),
        version: 1,
      }),
    }),
    ...resource<ItemCategory>(db, {
      path: '/item-categories',
      rows: () => db.categories,
      searchable: ['code', 'name'],
      list: {
        sorts: ['code', 'name', 'depth', 'path', 'created_at'],
        filters: ['is_active', 'depth'],
        custom: {
          parent_id: (c, v) => (v === 'root' ? c.parent_id === null : c.parent_id === v),
          subtree: (c, v) => c.id === v || descendantIds(v, db.categories).has(c.id),
        },
      },
      validate: (b, existing): Fields => {
        if (blank(b.code)) return { code: ['Kod zorunludur.'] }
        if (uniqueCode(db.categories, b, existing)) return { code: ['Bu kod zaten kullanılıyor.'] }
        if (blank(b.name)) return { name: ['Ad zorunludur.'] }
        const parent = b.parent_id as string | null
        if (existing && parent) {
          if (parent === existing.id || descendantIds(existing.id, db.categories).has(parent))
            return { parent_id: ['Kategori kendi alt kategorisinin altına taşınamaz.'] }
        }
        return null
      },
      create: (b) => ({
        id: nextId(db, 'cat'),
        code: String(b.code),
        name: String(b.name),
        parent_id: (b.parent_id as string | null) ?? null,
        version: 1,
      }),
    }),
    ...resource<Item>(db, {
      path: '/items',
      rows: () => db.items,
      searchable: ['code', 'name'],
      list: {
        sorts: ['code', 'name', 'type', 'created_at', 'updated_at'],
        filters: ['type', 'tracking', 'is_active', 'has_expiry', 'base_unit_id'],
        // The category and its whole subtree.
        custom: {
          category: (i, v) =>
            i.category_id !== null &&
            (i.category_id === v || descendantIds(v, db.categories).has(i.category_id)),
        },
      },
      search: (q, item) =>
        db.barcodes.some((b) => b.item_id === item.id && b.barcode.includes(q)) ||
        db.variants.some((v) => v.item_id === item.id && v.sku.toLocaleLowerCase('tr').includes(q)),
      validate: (b): Fields => {
        const fields: Record<string, string[]> = {}
        if (blank(b.name)) fields.name = ['Ad zorunludur.']
        if (blank(b.base_unit_id)) fields.base_unit_id = ['Temel birim zorunludur.']
        if (b.min_stock !== null && b.min_stock !== undefined && !isNonNegative(b.min_stock))
          fields.min_stock = ['Geçersiz miktar.']
        return Object.keys(fields).length ? fields : null
      },
      create: (b) => {
        const n = db.items.length + 1
        return baseItem({
          ...(b as Partial<Item>),
          id: nextId(db, 'item'),
          code: `STK${String(n).padStart(6, '0')}`,
          name: String(b.name),
          version: 1,
        })
      },
    }),
    ...itemChild<ItemVariant>(
      'variants',
      () => db.variants,
      (itemId, b) => ({
        id: nextId(db, 'var'),
        item_id: itemId,
        sku: String(b.sku),
        attributes: (b.attributes as Record<string, string> | undefined) ?? {},
        is_active: b.is_active !== false,
        version: 1,
      }),
      (b, existing): Fields => {
        if (blank(b.sku)) return { sku: ['SKU zorunludur.'] }
        if (db.variants.some((v) => v.sku === b.sku && v.id !== existing?.id))
          return { sku: ['Bu SKU zaten kullanılıyor.'] }
        return null
      },
      { sorts: ['sku', 'name', 'created_at'], filters: ['is_active'] },
    ),
    ...itemChild<ItemBarcode>(
      'barcodes',
      () => db.barcodes,
      (itemId, b) => {
        if (b.is_primary === true)
          for (const x of db.barcodes) if (x.item_id === itemId) x.is_primary = false
        return {
          id: nextId(db, 'bc'),
          item_id: itemId,
          barcode: String(b.barcode),
          type: (b.type as ItemBarcode['type'] | undefined) ?? 'other',
          unit_id: String(b.unit_id),
          variant_id: (b.variant_id as string | null) ?? null,
          is_primary: b.is_primary === true,
          version: 1,
        }
      },
      (b, existing): Fields => {
        const check = validateBarcode(
          text(b.barcode),
          (b.type as ItemBarcode['type'] | undefined) ?? 'other',
        )
        if (!check.ok) return { barcode: ['Barkod kontrol hanesi hatalı.'] }
        if (db.barcodes.some((x) => x.barcode === b.barcode && x.id !== existing?.id))
          return { barcode: ['Bu barkod başka bir stokta kullanılıyor.'] }
        return null
      },
      { sorts: ['barcode', 'created_at'], filters: ['type', 'is_primary'] },
    ),
    ...itemChild<ItemUnit>(
      'units',
      () => db.itemUnits,
      (itemId, b) => ({
        id: nextId(db, 'iu'),
        item_id: itemId,
        unit_id: String(b.unit_id),
        factor: String(b.factor),
        version: 1,
      }),
      (b, existing, itemId): Fields => {
        if (!isPositive(b.factor)) return { factor: ['Çarpan sıfırdan büyük olmalıdır.'] }
        const item = db.items.find((i) => i.id === itemId)
        if (item?.base_unit_id === b.unit_id)
          return { unit_id: ['Temel birim alternatif birim olamaz.'] }
        if (
          db.itemUnits.some(
            (u) => u.item_id === itemId && u.unit_id === b.unit_id && u.id !== existing?.id,
          )
        )
          return { unit_id: ['Bu birim zaten ekli.'] }
        return null
      },
      { sorts: ['created_at'], filters: [] },
    ),
    http.get(`${API}/price-lists/:id/lines`, ({ params, request }) =>
      paginate(db.lines[String(params.id)] ?? [], new URL(request.url), [], undefined, {
        sorts: ['min_qty', 'price', 'valid_from', 'created_at'],
        filters: ['item_id', 'variant_id', 'unit_id'],
      }),
    ),
    // Upsert by natural key, all or nothing; never deletes (PriceListService::upsertLines).
    http.put(`${API}/price-lists/:id/lines`, async ({ params, request }) => {
      const id = String(params.id)
      if (!db.priceLists.some((p) => p.id === id)) return notFound()
      const body = (await request.json()) as { lines?: Row[] }
      const lines = body.lines ?? []
      if (lines.length === 0) return validation({ lines: ['En az bir satır gerekli.'] })
      const existing = (db.lines[id] ??= [])
      const fields: Record<string, string[]> = {}
      const seen = new Map<string, number>()
      lines.forEach((l, i) => {
        const extra = Object.keys(l).filter((k) => !LINE_KEYS.includes(k))
        if (extra.length) {
          fields[`lines.${i}`] = ['Satırda tanımsız alan var.']
          return
        }
        if (!db.items.some((it) => it.id === l.item_id))
          fields[`lines.${i}.item_id`] = ['Stok bulunamadı.']
        if (!isPositive(l.price)) fields[`lines.${i}.price`] = ['Fiyat sıfırdan büyük olmalıdır.']
        if (l.min_qty !== undefined && !isNonNegative(l.min_qty))
          fields[`lines.${i}.min_qty`] = ['Geçersiz miktar.']
        if (typeof l.valid_from === 'string' && typeof l.valid_to === 'string')
          if (l.valid_to < l.valid_from)
            fields[`lines.${i}.valid_to`] = ['Bitiş başlangıçtan önce olamaz.']
        const key = naturalKey(l)
        if (seen.has(key)) fields[`lines.${i}.item_id`] = ['Satır tekrar ediyor.']
        seen.set(key, i)
        const match = existing.find((e) => naturalKey(e as unknown as Row) === key)
        if (match && l.version === undefined) fields[`lines.${i}.version`] = ['Sürüm zorunludur.']
        else if (match && l.version !== match.version)
          fields[`lines.${i}.version`] = ['Satır başka biri tarafından değiştirildi.']
        else if (!match && l.version !== undefined)
          fields[`lines.${i}.version`] = ['Satır bulunamadı.']
      })
      if (Object.keys(fields).length) return validation(fields)
      const saved = lines.map((l) => {
        const key = naturalKey(l)
        const match = existing.find((e) => naturalKey(e as unknown as Row) === key)
        const values = {
          item_id: String(l.item_id),
          variant_id: (l.variant_id as string | null | undefined) ?? null,
          unit_id: String(l.unit_id),
          min_qty: new Decimal(text(l.min_qty) || '0').toFixed(6),
          price: new Decimal(text(l.price)).toFixed(6),
          valid_from: (l.valid_from as string | null | undefined) ?? null,
          valid_to: (l.valid_to as string | null | undefined) ?? null,
        }
        if (match) {
          const changed = JSON.stringify({ ...match, ...values }) !== JSON.stringify(match)
          Object.assign(match, values)
          if (changed) match.version = (match.version ?? 1) + 1
          return match
        }
        const created: PriceListLine = { ...values, id: nextId(db, 'pll'), version: 1 }
        existing.push(created)
        return created
      })
      return HttpResponse.json({ data: saved, meta: { created: 0, updated: 0, unchanged: 0 } })
    }),
    http.delete(`${API}/price-lists/:id/lines/:lineId`, ({ params, request }) => {
      const rows = db.lines[String(params.id)] ?? []
      const idx = rows.findIndex((r) => r.id === String(params.lineId))
      if (idx < 0) return notFound()
      const version = new URL(request.url).searchParams.get('version')
      if (version !== null && Number(version) !== rows[idx]?.version) return conflict()
      rows.splice(idx, 1)
      return new HttpResponse(null, { status: 204 })
    }),
    ...resource<PriceList>(db, {
      path: '/price-lists',
      rows: () => db.priceLists,
      searchable: ['code', 'name'],
      list: {
        sorts: ['code', 'name', 'currency_code', 'valid_from', 'created_at'],
        filters: ['currency_code', 'is_active', 'is_default', 'tax_inclusive'],
      },
      validate: (b, existing): Fields => {
        if (blank(b.code)) return { code: ['Kod zorunludur.'] }
        if (uniqueCode(db.priceLists, b, existing)) return { code: ['Bu kod zaten kullanılıyor.'] }
        if (blank(b.name)) return { name: ['Ad zorunludur.'] }
        return null
      },
      create: (b) => ({
        ...(b as unknown as PriceList),
        id: nextId(db, 'pl'),
        version: 1,
      }),
    }),
    ...resource<DiscountRule>(db, {
      path: '/discount-rules',
      rows: () => db.discountRules,
      searchable: ['code', 'name'],
      list: {
        sorts: ['code', 'name', 'priority', 'valid_from', 'created_at'],
        filters: ['scope', 'is_active', 'stackable', 'party_id', 'scope_ref'],
      },
      validate: (b, existing): Fields => {
        const fields: Record<string, string[]> = {}
        if (blank(b.code)) fields.code = ['Kod zorunludur.']
        else if (uniqueCode(db.discountRules, b, existing))
          fields.code = ['Bu kod zaten kullanılıyor.']
        // DiscountRuleRequest: scope_ref only for item/category; party rules need party_id.
        const needsRef = b.scope === 'item' || b.scope === 'category'
        if (needsRef && blank(b.scope_ref)) fields.scope_ref = ['Kapsam kaydı zorunludur.']
        if (!needsRef && b.scope_ref !== null && b.scope_ref !== undefined)
          fields.scope_ref = ['Bu kapsamda kayıt seçilemez.']
        if (b.scope === 'party' && blank(b.party_id)) fields.party_id = ['Cari zorunludur.']
        if (b.min_qty !== undefined && typeof b.min_qty !== 'string')
          fields.min_qty = ['Geçersiz miktar.']
        if (
          typeof b.discount_percent !== 'string' ||
          new Decimal(b.discount_percent).greaterThan(100)
        )
          fields.discount_percent = ['İndirim 0 ile 100 arasında olmalıdır.']
        return Object.keys(fields).length ? fields : null
      },
      create: (b) => ({
        ...(b as unknown as DiscountRule),
        min_qty: new Decimal(text(b.min_qty) || '0').toFixed(6),
        id: nextId(db, 'dr'),
        version: 1,
      }),
    }),
    http.get(`${API}/pricing/resolve`, ({ request }) => {
      const url = new URL(request.url)
      const itemId = url.searchParams.get('item_id') ?? ''
      const currency = url.searchParams.get('currency') ?? ''
      if (!/^[A-Z]{3}$/.test(currency)) return validation({ currency: ['Para birimi zorunludur.'] })
      const item = db.items.find((i) => i.id === itemId)
      if (!item) return notFound()
      const qty = url.searchParams.get('qty') ?? '1'
      const partyId = url.searchParams.get('party_id')
      const party = db.parties.find((p) => p.id === partyId)
      const pick = (listId: string | null | undefined) => {
        if (!listId) return null
        const candidates = (db.lines[listId] ?? [])
          .filter((l) => l.item_id === itemId && new Decimal(l.min_qty).lessThanOrEqualTo(qty))
          .sort((a, b) => new Decimal(b.min_qty).comparedTo(a.min_qty))
        return candidates[0] ?? null
      }
      const defaultList = db.priceLists.find((p) => p.is_default)
      let source = 'none'
      let listId: string | null = null
      let chosen = pick(party?.price_list_id)
      if (chosen) {
        source = 'party_price_list'
        listId = party?.price_list_id ?? null
      } else {
        chosen = pick(defaultList?.id)
        if (chosen) {
          source = 'default_price_list'
          listId = defaultList?.id ?? null
        }
      }
      const rule = db.discountRules
        .filter(
          (r) =>
            r.is_active &&
            new Decimal(r.min_qty || '0').lessThanOrEqualTo(qty) &&
            (r.party_id === null || r.party_id === partyId) &&
            (r.scope === 'all' ||
              r.scope === 'party' ||
              (r.scope === 'item' && r.scope_ref === itemId) ||
              (r.scope === 'category' && r.scope_ref === item.category_id)),
        )
        .sort((a, b) => b.priority - a.priority)[0]
      const discount = rule?.discount_percent ?? '0'
      const net =
        chosen === null
          ? null
          : new Decimal(chosen.price)
              .times(new Decimal(1).minus(new Decimal(discount).dividedBy(100)))
              .toDecimalPlaces(6)
              .toFixed(6)
      return HttpResponse.json({
        data: {
          item_id: itemId,
          variant_id: url.searchParams.get('variant_id'),
          party_id: partyId,
          qty,
          unit_id: url.searchParams.get('unit_id') ?? item.base_unit_id,
          date: url.searchParams.get('date'),
          unit_price: chosen?.price ?? null,
          net_unit_price: net,
          currency,
          price_list_id: listId,
          price_list_line_id: chosen?.id ?? null,
          price_unit_id: chosen?.unit_id ?? null,
          tax_inclusive: listId ? false : null,
          discount_percent: discount,
          discount_rule_ids: rule ? [rule.id] : [],
          source,
        },
      })
    }),
    http.get(`${API}/tax-codes`, ({ request }) =>
      paginate(db.taxCodes, new URL(request.url), ['code', 'name']),
    ),
    http.get(`${API}/tax-codes/:id`, ({ params }) => {
      const row = db.taxCodes.find((t) => t.id === String(params.id))
      return row ? HttpResponse.json({ data: row }) : notFound()
    }),
    http.get(`${API}/currencies`, ({ request }) =>
      paginate(db.currencies, new URL(request.url), ['code', 'name']),
    ),
    http.get(`${API}/parties`, ({ request }) =>
      paginate(db.parties, new URL(request.url), ['code', 'name']),
    ),
    http.get(`${API}/parties/:id`, ({ params }) => {
      const row = db.parties.find((p) => p.id === String(params.id))
      return row ? HttpResponse.json({ data: row }) : notFound()
    }),
  ]
}
