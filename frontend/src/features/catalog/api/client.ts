import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { ApiError, platform, withIdempotency } from '@/platform'
import type {
  CurrencyRef,
  DiscountRule,
  DiscountRuleInput,
  Envelope,
  Item,
  ItemBarcode,
  ItemBarcodeInput,
  ItemCategory,
  ItemCategoryInput,
  ItemInput,
  ItemUnit,
  ItemUnitInput,
  ItemVariant,
  ItemVariantInput,
  Paginated,
  PartyRef,
  PriceList,
  PriceListInput,
  PriceListLine,
  PriceListLineInput,
  PricingQuery,
  PricingResult,
  TaxCodeRef,
  Unit,
  UnitConversion,
  UnitInput,
} from '../types'

const http = () => platform.http
const seg = (id: string) => encodeURIComponent(id)

type Params = Record<string, string | number>

export const LIMIT_EXCEEDED = 'LIMIT_EXCEEDED'
export const INCOMPLETE_LOAD = 'INCOMPLETE_LOAD'
/** 500 pages × 100 rows: above this a full in-browser list is not workable. */
export const MAX_PAGES = 500

/**
 * Every page of a list, 100 per page. Never returns a partial list: more pages than `maxPages`
 * throws LIMIT_EXCEEDED, and fewer rows than the server's total throws INCOMPLETE_LOAD, so
 * callers that replace the whole set (price list lines) never save over rows they did not see.
 */
export async function fetchAll<T>(
  url: string,
  params: Params = {},
  signal?: AbortSignal,
  maxPages = MAX_PAGES,
) {
  const out: T[] = []
  let total: number
  for (let page = 1; ; page++) {
    const res = await http().get<Paginated<T>>(url, {
      params: { ...params, page, per_page: 100 },
      signal,
    })
    total = res.meta.pagination.total
    const last = res.meta.pagination.last_page
    if (last > maxPages) {
      throw new ApiError(0, LIMIT_EXCEEDED, `More than ${maxPages * 100} rows.`)
    }
    out.push(...res.data)
    if (page >= last || res.data.length === 0) break
  }
  if (out.length < total) throw new ApiError(0, INCOMPLETE_LOAD, 'List changed while loading.')
  return out
}

function list<T>(url: string, query: ListQueryState, signal?: AbortSignal) {
  return http().get<Paginated<T>>(url, { params: toListParams(query), signal })
}

/** Laravel encodes an empty json object as `[]` (or null); the UI always wants a record. */
function withAttributes<T extends { attributes: unknown }>(row: T): T {
  const a = row.attributes
  return a !== null && typeof a === 'object' && !Array.isArray(a) ? row : { ...row, attributes: {} }
}

/** Create/update/delete for one flat resource; creates carry an Idempotency-Key. */
function crud<T, I>(base: string) {
  return {
    list: (query: ListQueryState, signal?: AbortSignal) => list<T>(base, query, signal),
    all: (params?: Params, signal?: AbortSignal) => fetchAll<T>(base, params, signal),
    get: (id: string, signal?: AbortSignal) =>
      http()
        .get<Envelope<T>>(`${base}/${seg(id)}`, { signal })
        .then((r) => r.data),
    create: (input: I, idempotencyKey?: string) =>
      http()
        .post<Envelope<T>>(base, input, withIdempotency({}, idempotencyKey))
        .then((r) => r.data),
    update: (id: string, input: Partial<I> & { version: number }) =>
      http()
        .patch<Envelope<T>>(`${base}/${seg(id)}`, input)
        .then((r) => r.data),
    remove: (id: string) => http().delete<unknown>(`${base}/${seg(id)}`),
  }
}

/** Sub-resource of an item (/items/{id}/variants ...). */
function itemChild<T, I>(path: string) {
  const base = (itemId: string) => `/items/${seg(itemId)}/${path}`
  return {
    list: (itemId: string, signal?: AbortSignal) => fetchAll<T>(base(itemId), {}, signal),
    create: (itemId: string, input: I, idempotencyKey?: string) =>
      http()
        .post<Envelope<T>>(base(itemId), input, withIdempotency({}, idempotencyKey))
        .then((r) => r.data),
    update: (itemId: string, id: string, input: Partial<I> & { version?: number }) =>
      http()
        .patch<Envelope<T>>(`${base(itemId)}/${seg(id)}`, input)
        .then((r) => r.data),
    remove: (itemId: string, id: string) => http().delete<unknown>(`${base(itemId)}/${seg(id)}`),
  }
}

export const unitsApi = crud<Unit, UnitInput>('/units')
export const conversionsApi = crud<UnitConversion, Omit<UnitConversion, 'id' | 'version'>>(
  '/unit-conversions',
)
export const categoriesApi = crud<ItemCategory, ItemCategoryInput>('/item-categories')
const rawItems = crud<Item, ItemInput>('/items')
export const itemsApi = {
  ...rawItems,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    rawItems.list(query, signal).then((r) => ({ ...r, data: r.data.map(withAttributes) })),
  get: (id: string, signal?: AbortSignal) => rawItems.get(id, signal).then(withAttributes),
  create: (input: ItemInput, idempotencyKey?: string) =>
    rawItems.create(input, idempotencyKey).then(withAttributes),
  update: (id: string, input: Partial<ItemInput> & { version: number }) =>
    rawItems.update(id, input).then(withAttributes),
}
const rawVariants = itemChild<ItemVariant, ItemVariantInput>('variants')
export const variantsApi = {
  ...rawVariants,
  list: (itemId: string, signal?: AbortSignal) =>
    rawVariants.list(itemId, signal).then((rows) => rows.map(withAttributes)),
}
export const barcodesApi = itemChild<ItemBarcode, ItemBarcodeInput>('barcodes')
export const itemUnitsApi = itemChild<ItemUnit, ItemUnitInput>('units')
export const priceListsApi = {
  ...crud<PriceList, PriceListInput>('/price-lists'),
  lines: (id: string, signal?: AbortSignal) =>
    fetchAll<PriceListLine>(`/price-lists/${seg(id)}/lines`, {}, signal),
  /**
   * PUT upserts `lines` by natural key in one all-or-nothing request (per-line errors come back
   * as `lines.N.field`, N = index in `lines`); it never deletes, so lines the user removed are
   * deleted one by one afterwards (with their version). Returns the saved lines.
   */
  saveLines: async (
    id: string,
    lines: PriceListLineInput[],
    removed: readonly { id: string; version?: number }[] = [],
  ) => {
    const saved =
      lines.length > 0
        ? await http()
            .put<Envelope<PriceListLine[]>>(`/price-lists/${seg(id)}/lines`, { lines })
            .then((r) => r.data)
        : []
    for (const line of removed) {
      await http().delete<unknown>(`/price-lists/${seg(id)}/lines/${seg(line.id)}`, {
        params: line.version === undefined ? {} : { version: line.version },
      })
    }
    return saved
  },
}
export const discountRulesApi = crud<DiscountRule, DiscountRuleInput>('/discount-rules')

export const pricingApi = {
  resolve: (query: PricingQuery, signal?: AbortSignal) => {
    const params: Params = {}
    for (const [k, v] of Object.entries(query) as [string, string | undefined][])
      if (v !== undefined && v !== '') params[k] = v
    return http()
      .get<Envelope<PricingResult>>('/pricing/resolve', { params, signal })
      .then((r) => r.data)
  },
}

/** Lookups owned by other modules, read through their public endpoints. */
export const lookupsApi = {
  taxCodes: (q: string, signal?: AbortSignal) =>
    http()
      .get<Paginated<TaxCodeRef>>('/tax-codes', {
        params: { q, per_page: 20, 'filter[is_active]': 'true' },
        signal,
      })
      .then((r) => r.data),
  taxCode: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<TaxCodeRef>>(`/tax-codes/${seg(id)}`, { signal })
      .then((r) => r.data),
  currencies: (signal?: AbortSignal) => fetchAll<CurrencyRef>('/currencies', {}, signal),
  parties: (q: string, signal?: AbortSignal) =>
    http()
      .get<Paginated<PartyRef>>('/parties', { params: { q, per_page: 20 }, signal })
      .then((r) => r.data),
  party: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<PartyRef>>(`/parties/${seg(id)}`, { signal })
      .then((r) => r.data),
}
