import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { ApiError, isApiError, platform, withIdempotency } from '@/platform'
import type {
  ApiStockDocument,
  CodeName,
  CountStartInput,
  CountUpdateInput,
  Envelope,
  ImportResult,
  ItemRef,
  Pagination,
  Paginated,
  ReservationInput,
  ReverseInput,
  StockDocument,
  StockDocumentInput,
  StockDocumentSummary,
  StockReservation,
  UnitChoice,
} from '../types'

const http = () => platform.http
const seg = (id: string) => encodeURIComponent(id)

export type Params = Record<string, string | number>

export const LIMIT_EXCEEDED = 'LIMIT_EXCEEDED'

/** Every page of a list (100 per page); more than `maxPages` pages throws LIMIT_EXCEEDED. */
export async function fetchAll<T>(
  url: string,
  params: Params = {},
  signal?: AbortSignal,
  maxPages = 20,
): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; ; page++) {
    const res = await http().get<Paginated<T>>(url, {
      params: { ...params, page, per_page: 100 },
      signal,
    })
    if (res.meta.pagination.last_page > maxPages) {
      throw new ApiError(0, LIMIT_EXCEEDED, `More than ${maxPages * 100} rows.`)
    }
    out.push(...res.data)
    if (page >= res.meta.pagination.last_page || res.data.length === 0) break
  }
  return out
}

/** The API names only the causer; the audit trail wants its entry shape. */
export function toDocument(raw: ApiStockDocument): StockDocument {
  const { audit, ...rest } = raw
  return {
    ...rest,
    lines: [...raw.lines].sort((a, b) => a.line_no - b.line_no),
    audit: audit?.map((a, i) => ({
      id: `${raw.id}-a${i}`,
      event: a.event,
      description: a.description,
      causer: a.causer_id ? { id: a.causer_id, name: a.causer_name ?? '' } : null,
      created_at: a.created_at ?? '',
      properties: null,
    })),
  }
}

const DOCS = '/stock-documents'
const one = (r: Envelope<ApiStockDocument>) => toDocument(r.data)

export const documentsApi = {
  path: DOCS,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<StockDocumentSummary>>(DOCS, { params: toListParams(query), signal }),
  get: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<ApiStockDocument>>(`${DOCS}/${seg(id)}`, { signal })
      .then(one),
  create: (input: StockDocumentInput, idempotencyKey: string) =>
    http()
      .post<Envelope<ApiStockDocument>>(DOCS, input, withIdempotency({}, idempotencyKey))
      .then(one),
  /** Header and lines of a draft (lines replace the stored ones); counts use updateCount. */
  update: (id: string, input: StockDocumentInput & { version: number }) =>
    http()
      .patch<Envelope<ApiStockDocument>>(`${DOCS}/${seg(id)}`, input)
      .then(one),
  /** Starts a count: with freeze the server snapshots the warehouse balances as lines. */
  startCount: (input: CountStartInput, idempotencyKey: string) =>
    http()
      .post<Envelope<ApiStockDocument>>(DOCS, input, withIdempotency({}, idempotencyKey))
      .then(one),
  /** Counted quantities of a count draft and lines for stock found outside the snapshot. */
  updateCount: (id: string, input: CountUpdateInput) =>
    http()
      .patch<Envelope<ApiStockDocument>>(`${DOCS}/${seg(id)}/counts`, input)
      .then(one),
  post: (id: string, version: number, idempotencyKey: string) =>
    http()
      .post<Envelope<ApiStockDocument>>(
        `${DOCS}/${seg(id)}/post`,
        { version },
        withIdempotency({}, idempotencyKey),
      )
      .then(one),
  /** Mirrors the movements and the journal entry; the same document becomes cancelled. */
  reverse: (id: string, input: ReverseInput, idempotencyKey: string) =>
    http()
      .post<Envelope<ApiStockDocument>>(
        `${DOCS}/${seg(id)}/reverse`,
        input,
        withIdempotency({}, idempotencyKey),
      )
      .then(one),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${DOCS}/${seg(id)}`, { params: { version } }),
  /**
   * CSV lines of a count draft (columns item_code, counted_quantity, location_code?, lot_no?;
   * comma or semicolon separated). A dry run only reports; a real run applies a clean file
   * (counts set on matching lines, other rows added); any row error blocks applying.
   */
  importLines: (
    id: string,
    file: File,
    options: { dryRun: boolean; version: number; idempotencyKey: string },
  ) => {
    const body = new FormData()
    body.append('file', file)
    body.append('dry_run', options.dryRun ? '1' : '0')
    body.append('version', String(options.version))
    return http()
      .post<Envelope<ImportResult>>(
        `${DOCS}/${seg(id)}/import`,
        body,
        withIdempotency({}, options.idempotencyKey),
      )
      .then((r) => r.data)
  },
}

const RESERVATIONS = '/stock-reservations'

export const reservationsApi = {
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<StockReservation>>(RESERVATIONS, {
      params: toListParams(query),
      signal,
    }),
  /** meta.shortage: how much exceeded availability under a soft policy. */
  create: (input: ReservationInput, idempotencyKey: string) =>
    http().post<Envelope<StockReservation> & { meta?: { shortage?: string | null } }>(
      RESERVATIONS,
      input,
      withIdempotency({}, idempotencyKey),
    ),
  release: (id: string, version: number, idempotencyKey: string) =>
    http()
      .post<Envelope<StockReservation>>(
        `${RESERVATIONS}/${seg(id)}/release`,
        { version },
        withIdempotency({}, idempotencyKey),
      )
      .then((r) => r.data),
}

interface ItemUnitRow {
  id: string
  item_id: string
  unit_id: string
  factor: string
}

export interface UnitRow extends CodeName {
  symbol?: string | null
  is_active?: boolean
}

interface BarcodeRow {
  id: string
  item_id: string
  barcode: string
  unit_id: string
  variant_id: string | null
}

export interface BarcodeHit {
  item: ItemRef
  /** Unit the barcode is printed for (a case barcode means one case). */
  unitId: string
}

export interface LotRef {
  id: string
  lot_no: string
  expiry_date: string | null
  on_hand?: string
}

/** Lookups owned by other modules (Catalog items and units, Inventory lots). */
export const lookupsApi = {
  units: (signal?: AbortSignal) => fetchAll<UnitRow>('/units', { sort: 'code' }, signal),
  categories: (signal?: AbortSignal) =>
    fetchAll<CodeName & { parent_id: string | null }>('/item-categories', {}, signal),
  item: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<ItemRef>>(`/items/${seg(id)}`, { signal })
      .then((r) => r.data),
  /** Every stock item of the company (Catalog list, 100 per page, at most 50 pages). */
  stockItems: (signal?: AbortSignal) =>
    fetchAll<ItemRef>('/items', { 'filter[type]': 'stock', sort: 'code' }, signal, 50),
  /**
   * Items by id (Catalog has no id filter): one GET per item for a few, otherwise the stock item
   * list plus single reads of what it lacks. Unknown or unreadable items are left out.
   */
  itemsByIds: async (ids: readonly string[], signal?: AbortSignal): Promise<ItemRef[]> => {
    const wanted = [...new Set(ids.filter(Boolean))]
    const single = (id: string) =>
      lookupsApi.item(id, signal).catch((error: unknown) => {
        if (isApiError(error) && (error.status === 404 || error.status === 403)) return null
        throw error
      })
    let found: ItemRef[] = []
    if (wanted.length > 25) {
      const all = await lookupsApi.stockItems(signal).catch(() => [] as ItemRef[])
      const set = new Set(wanted)
      found = all.filter((i) => set.has(i.id))
    }
    const missing = wanted.filter((id) => !found.some((i) => i.id === id))
    const rest = await Promise.all(missing.slice(0, 200).map(single))
    return [...found, ...rest.filter((i): i is ItemRef => i !== null)]
  },
  searchItems: (q: string, signal?: AbortSignal) =>
    http()
      .get<Paginated<ItemRef>>('/items', {
        params: { q, 'filter[is_active]': 'true', per_page: 10 },
        signal,
      })
      .then((r) => r.data),
  /** GET /stock-lots/{id} (inventory.stock.view). */
  lot: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<LotRef>>(`/stock-lots/${seg(id)}`, { signal })
      .then((r) => r.data),
  /** Lots of an item that have stock (GET /stock-lots, inventory.stock.view). */
  itemLots: (itemId: string, signal?: AbortSignal) =>
    fetchAll<LotRef>(
      '/stock-lots',
      { 'filter[item_id]': itemId, 'filter[with_stock]': '1' },
      signal,
    ),
  /**
   * The units a line of the item may use: its base unit (factor 1) and its alternate units with
   * their factor to the base unit (Catalog /items/{id}/units), labelled from /units.
   */
  itemUnits: async (item: ItemRef, signal?: AbortSignal): Promise<UnitChoice[]> => {
    const [alternates, units] = await Promise.all([
      fetchAll<ItemUnitRow>(`/items/${seg(item.id)}/units`, {}, signal),
      fetchAll<UnitRow>('/units', { sort: 'code' }, signal),
    ])
    const label = (id: string) => units.find((u) => u.id === id)
    const base = label(item.base_unit_id) ?? item.base_unit
    return [
      {
        unit_id: item.base_unit_id,
        code: base?.code ?? '',
        name: base?.name ?? '',
        factor: '1',
      },
      ...alternates
        .filter((a) => a.unit_id !== item.base_unit_id)
        .map((a) => ({
          unit_id: a.unit_id,
          code: label(a.unit_id)?.code ?? '',
          name: label(a.unit_id)?.name ?? '',
          factor: a.factor,
        })),
    ]
  },
  /**
   * Resolves a scanned code: the item search matches barcodes, codes and SKUs; an exact barcode
   * of one of the hits wins (with the unit it is printed for), then an exact item code.
   */
  resolveBarcode: async (code: string, signal?: AbortSignal): Promise<BarcodeHit | null> => {
    const scanned = code.trim()
    if (!scanned) return null
    const hits = await lookupsApi.searchItems(scanned, signal)
    for (const item of hits.slice(0, 5)) {
      const barcodes = await fetchAll<BarcodeRow>(
        `/items/${seg(item.id)}/barcodes`,
        { 'filter[barcode]': scanned },
        signal,
      )
      const exact = barcodes.find((b) => b.barcode === scanned)
      if (exact) return { item, unitId: exact.unit_id }
    }
    const byCode = hits.find(
      (i) => i.code.toLocaleLowerCase('tr') === scanned.toLocaleLowerCase('tr'),
    )
    return byCode ? { item: byCode, unitId: byCode.base_unit_id } : null
  },
}

/**
 * Stock reports: `data` holds the rows of the page; `meta` the report figures (as_of or the
 * range, group_by, basis, totals, opening/closing of the kartex) and `pagination`. Reorder
 * suggestions return a plain row list without meta.
 */
export interface ReportResponse<R = Record<string, unknown>> {
  data: R[]
  meta?: Record<string, unknown> & { pagination?: Pagination }
}

export const reportsApi = {
  get: (path: string, params: Params, signal?: AbortSignal) =>
    http().get<ReportResponse>(path, { params, signal }),
}
