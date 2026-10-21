import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { ApiError, platform, withIdempotency } from '@/platform'
import { LIMIT_EXCEEDED } from './errors'
import { STOCK_GROUPINGS } from './types'
import type {
  CursorMeta,
  CursorResponse,
  ItemResponse,
  ItemStock,
  ListResponse,
  LocationInput,
  LotTrace,
  StockBalance,
  StockBalanceTotals,
  StockGrouping,
  StockLot,
  StockMovement,
  StockSerial,
  Warehouse,
  WarehouseInput,
  WarehouseLocation,
} from './types'

type Params = Record<string, string | number>

const http = () => platform.http
const seg = (id: string) => encodeURIComponent(id)
const PER_PAGE = 100

export const INV_PATHS = {
  warehouses: '/warehouses',
  balances: '/stock-balances',
  movements: '/stock-movements',
  lots: '/stock-lots',
  serials: '/stock-serials',
} as const

/** Every page of a list endpoint; more than `maxPages` pages fails instead of truncating. */
export async function fetchAll<T>(
  path: string,
  params: Params = {},
  signal?: AbortSignal,
  maxPages = 20,
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; ; page += 1) {
    const res = await http().get<ListResponse<T>>(path, {
      params: { ...params, page, per_page: PER_PAGE },
      signal,
    })
    rows.push(...res.data)
    const last = res.meta.pagination.last_page
    if (page >= last || res.data.length === 0) return rows
    if (page >= maxPages) {
      throw new ApiError(0, LIMIT_EXCEEDED, `More than ${maxPages * PER_PAGE} records.`)
    }
  }
}

const data = async <T>(p: Promise<ItemResponse<T>>): Promise<T> => (await p).data

/** Cursor meta may sit at `meta` or under `meta.pagination`; both are accepted. */
export function cursorMeta(meta: CursorResponse<unknown>['meta'] | undefined): CursorMeta {
  const source = meta && 'pagination' in meta ? meta.pagination : meta
  return {
    next_cursor: source?.next_cursor ?? null,
    prev_cursor: source?.prev_cursor ?? null,
    per_page: source?.per_page ?? 0,
  }
}

export const warehousesApi = {
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<ListResponse<Warehouse>>(INV_PATHS.warehouses, {
      params: toListParams(query),
      signal,
    }),
  all: (signal?: AbortSignal) =>
    fetchAll<Warehouse>(INV_PATHS.warehouses, { sort: 'code' }, signal),
  get: (id: string, signal?: AbortSignal) =>
    data(http().get<ItemResponse<Warehouse>>(`${INV_PATHS.warehouses}/${seg(id)}`, { signal })),
  create: (input: WarehouseInput, key: string) =>
    data(
      http().post<ItemResponse<Warehouse>>(INV_PATHS.warehouses, input, withIdempotency({}, key)),
    ),
  update: (id: string, version: number, patch: Partial<WarehouseInput>) =>
    data(
      http().patch<ItemResponse<Warehouse>>(`${INV_PATHS.warehouses}/${seg(id)}`, {
        ...patch,
        version,
      }),
    ),
  remove: async (id: string, version: number) => {
    await http().delete<unknown>(`${INV_PATHS.warehouses}/${seg(id)}`, { params: { version } })
  },
}

const locationsPath = (warehouseId: string) =>
  `${INV_PATHS.warehouses}/${seg(warehouseId)}/locations`

export const locationsApi = {
  all: (warehouseId: string, signal?: AbortSignal) =>
    fetchAll<WarehouseLocation>(locationsPath(warehouseId), { sort: 'code' }, signal),
  create: (warehouseId: string, input: LocationInput, key: string) =>
    data(
      http().post<ItemResponse<WarehouseLocation>>(
        locationsPath(warehouseId),
        input,
        withIdempotency({}, key),
      ),
    ),
  update: (warehouseId: string, id: string, patch: Partial<LocationInput>, version?: number) =>
    data(
      http().patch<ItemResponse<WarehouseLocation>>(`${locationsPath(warehouseId)}/${seg(id)}`, {
        ...patch,
        ...(version !== undefined ? { version } : {}),
      }),
    ),
  remove: async (warehouseId: string, id: string) => {
    await http().delete<unknown>(`${locationsPath(warehouseId)}/${seg(id)}`)
  },
}

export type BalanceListResponse = ListResponse<StockBalance, { totals?: StockBalanceTotals }>

/** Grouping level of the stock status list; kept with the filters (URL, saved views). */
export function balanceGroup(query: ListQueryState): StockGrouping {
  return STOCK_GROUPINGS.find((g) => g === query.filters.group) ?? 'item_warehouse'
}

/**
 * ListQuery params of the balance list. The grouping travels as `group_by`, not as a filter.
 * `paged: false` leaves page/per_page out (exports).
 */
export function balanceParams(query: ListQueryState, paged = true): Params {
  const filters = Object.fromEntries(Object.entries(query.filters).filter(([k]) => k !== 'group'))
  const params: Params = { ...toListParams({ ...query, filters }), group_by: balanceGroup(query) }
  if (!paged) {
    delete params.page
    delete params.per_page
  }
  return params
}

export const balancesApi = {
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<BalanceListResponse>(INV_PATHS.balances, {
      params: balanceParams(query),
      signal,
    }),
  item: (itemId: string, signal?: AbortSignal) =>
    data(http().get<ItemResponse<ItemStock>>(`/items/${seg(itemId)}/stock`, { signal })),
}

export interface MovementPage {
  rows: StockMovement[]
  next: string | null
}

export const movementsApi = {
  page: async (
    filters: Record<string, string>,
    cursor: string | null,
    perPage: number,
    signal?: AbortSignal,
  ): Promise<MovementPage> => {
    const params: Params = { per_page: perPage, sort: '-seq' }
    for (const [key, value] of Object.entries(filters)) {
      if (value !== '') params[`filter[${key}]`] = value
    }
    if (cursor) params.cursor = cursor
    const res = await http().get<CursorResponse<StockMovement>>(INV_PATHS.movements, {
      params,
      signal,
    })
    return { rows: res.data, next: cursorMeta(res.meta).next_cursor }
  },
}

export const lotsApi = {
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<ListResponse<StockLot>>(INV_PATHS.lots, { params: toListParams(query), signal }),
  trace: (id: string, signal?: AbortSignal) =>
    data(http().get<ItemResponse<LotTrace>>(`${INV_PATHS.lots}/${seg(id)}/trace`, { signal })),
}

export const serialsApi = {
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<ListResponse<StockSerial>>(INV_PATHS.serials, {
      params: toListParams(query),
      signal,
    }),
}
