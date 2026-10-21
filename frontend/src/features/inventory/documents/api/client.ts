import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { ApiError, platform, withIdempotency } from '@/platform'
import type {
  ApiStockDocument,
  CodeName,
  CountStartInput,
  CountUpdateInput,
  Envelope,
  ImportResult,
  ItemRef,
  LocationRef,
  Paginated,
  ReverseInput,
  StockDocument,
  StockDocumentInput,
  StockDocumentSummary,
  StockReservation,
  UnitChoice,
  WarehouseRef,
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
  update: (id: string, input: StockDocumentInput & { version: number }) =>
    http()
      .patch<Envelope<ApiStockDocument>>(`${DOCS}/${seg(id)}`, input)
      .then(one),
  /** Starts a count: the server freezes the system quantities of the scope as lines. */
  startCount: (input: CountStartInput, idempotencyKey: string) =>
    http()
      .post<Envelope<ApiStockDocument>>(DOCS, input, withIdempotency({}, idempotencyKey))
      .then(one),
  /** Saves counted quantities of a count draft. */
  updateCount: (id: string, input: CountUpdateInput) =>
    http()
      .patch<Envelope<ApiStockDocument>>(`${DOCS}/${seg(id)}`, input)
      .then(one),
  post: (id: string, version: number, idempotencyKey: string) =>
    http()
      .post<Envelope<ApiStockDocument>>(
        `${DOCS}/${seg(id)}/post`,
        { version },
        withIdempotency({}, idempotencyKey),
      )
      .then(one),
  /** Mirrors the movements and the journal entry; the document becomes cancelled. */
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
   * CSV of counted quantities (columns item_code, lot_no, location_code, counted_quantity).
   * A dry run validates and matches rows to lines without saving; the real run saves them.
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
        `${DOCS}/${seg(id)}/lines/import`,
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
  release: (id: string, input: { version: number; reason: string | null }) =>
    http()
      .post<Envelope<StockReservation>>(`${RESERVATIONS}/${seg(id)}/release`, input)
      .then((r) => r.data),
}

interface ItemUnitRow {
  id: string
  item_id: string
  unit_id: string
  factor: string
}

interface UnitRow extends CodeName {
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

/** Lookups owned by other modules (Catalog, Inventory warehouses), read via their endpoints. */
export const lookupsApi = {
  warehouses: (signal?: AbortSignal) =>
    fetchAll<WarehouseRef>('/warehouses', { sort: 'code' }, signal),
  locations: (warehouseId: string, signal?: AbortSignal) =>
    fetchAll<LocationRef>(`/warehouses/${seg(warehouseId)}/locations`, { sort: 'code' }, signal),
  units: (signal?: AbortSignal) => fetchAll<UnitRow>('/units', { sort: 'code' }, signal),
  categories: (signal?: AbortSignal) =>
    fetchAll<CodeName & { parent_id: string | null }>('/item-categories', {}, signal),
  item: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<ItemRef>>(`/items/${seg(id)}`, { signal })
      .then((r) => r.data),
  searchItems: (q: string, signal?: AbortSignal) =>
    http()
      .get<Paginated<ItemRef>>('/items', {
        params: { q, 'filter[is_active]': 'true', per_page: 10 },
        signal,
      })
      .then((r) => r.data),
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

export const reportsApi = {
  get: <T>(path: string, params: Params, signal?: AbortSignal) =>
    http()
      .get<Envelope<T>>(path, { params, signal })
      .then((r) => r.data),
}
