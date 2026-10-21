import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { platform, withIdempotency } from '@/platform'
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

/** Every page of a small master-data list (units, categories): 100 per page, bounded. */
export async function fetchAll<T>(url: string, params: Params = {}, signal?: AbortSignal) {
  const out: T[] = []
  for (let page = 1; page <= 50; page++) {
    const res = await http().get<Paginated<T>>(url, {
      params: { ...params, page, per_page: 100 },
      signal,
    })
    out.push(...res.data)
    const last = res.meta.last_page ?? Math.ceil(res.meta.total / 100)
    if (page >= last || res.data.length === 0) break
  }
  return out
}

function list<T>(url: string, query: ListQueryState, signal?: AbortSignal) {
  return http().get<Paginated<T>>(url, { params: toListParams(query), signal })
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
export const itemsApi = crud<Item, ItemInput>('/items')
export const variantsApi = itemChild<ItemVariant, ItemVariantInput>('variants')
export const barcodesApi = itemChild<ItemBarcode, ItemBarcodeInput>('barcodes')
export const itemUnitsApi = itemChild<ItemUnit, ItemUnitInput>('units')
export const priceListsApi = {
  ...crud<PriceList, PriceListInput>('/price-lists'),
  lines: (id: string, signal?: AbortSignal) =>
    fetchAll<PriceListLine>(`/price-lists/${seg(id)}/lines`, {}, signal),
  /** Replaces all lines in one request; per-line errors come back as `lines.N.field`. */
  saveLines: (id: string, lines: PriceListLine[]) =>
    http()
      .put<Paginated<PriceListLine> | Envelope<PriceListLine[]>>(`/price-lists/${seg(id)}/lines`, {
        lines,
      })
      .then((r) => r.data),
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
