import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { platform } from '@/platform'
import { STOCK_GROUPINGS } from './types'
import type {
  CursorResponse,
  ItemResponse,
  ItemStock,
  ListResponse,
  LotTrace,
  StockBalance,
  StockGrouping,
  StockLot,
  StockMovement,
  StockSerial,
} from './types'

type Params = Record<string, string | number>

const http = () => platform.http
const seg = (id: string) => encodeURIComponent(id)

export const INV_PATHS = {
  balances: '/stock-balances',
  movements: '/stock-movements',
  lots: '/stock-lots',
  serials: '/stock-serials',
} as const

/** Most rows one ledger request may ask for (StockMovementController::MAX_PER_PAGE). */
export const MOVEMENTS_MAX_PER_PAGE = 200

const data = async <T>(p: Promise<ItemResponse<T>>): Promise<T> => (await p).data

/** List params without page/per_page (exports take the filters of the list). */
export function exportListParams(query: ListQueryState): Params {
  const params = toListParams(query)
  delete params.page
  delete params.per_page
  return params
}

/** Grouping level of the stock status list; kept with the filters (URL, saved views). */
export function balanceGroup(query: ListQueryState): StockGrouping {
  return STOCK_GROUPINGS.find((g) => g === query.filters.group) ?? 'warehouse'
}

/**
 * Params of the balance list. The grouping travels as `group_by`, not as a filter.
 * `paged: false` leaves page/per_page out (exports).
 */
export function balanceParams(query: ListQueryState, paged = true): Params {
  const filters = Object.fromEntries(Object.entries(query.filters).filter(([k]) => k !== 'group'))
  const rest = { ...query, filters }
  return {
    ...(paged ? toListParams(rest) : exportListParams(rest)),
    group_by: balanceGroup(query),
  }
}

export const balancesApi = {
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<ListResponse<StockBalance>>(INV_PATHS.balances, {
      params: balanceParams(query),
      signal,
    }),
  item: (itemId: string, signal?: AbortSignal) =>
    data(http().get<ItemResponse<ItemStock>>(`/items/${seg(itemId)}/stock`, { signal })),
}

export interface MovementPage {
  rows: StockMovement[]
  next: number | null
}

/** filter[...] params of the ledger (empty values left out). */
export function movementFilterParams(filters: Record<string, string>): Params {
  const params: Params = {}
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '') params[`filter[${key}]`] = value
  }
  return params
}

export const movementsApi = {
  /** One page of the ledger, newest first; `cursor` is the seq after which to continue. */
  page: async (
    filters: Record<string, string>,
    cursor: number | null,
    perPage: number,
    signal?: AbortSignal,
  ): Promise<MovementPage> => {
    const params: Params = {
      ...movementFilterParams(filters),
      per_page: Math.min(perPage, MOVEMENTS_MAX_PER_PAGE),
    }
    if (cursor !== null) params.cursor = cursor
    const res = await http().get<CursorResponse<StockMovement>>(INV_PATHS.movements, {
      params,
      signal,
    })
    return { rows: res.data, next: res.meta.next_cursor ?? null }
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
