import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { ApiError, platform, withIdempotency } from '@/platform'
import type { ItemResponse, ListResponse } from '../types'

type Params = Record<string, string | number | boolean | undefined>

const PER_PAGE = 100
/** 10,000 rows; beyond that a select or tree is the wrong tool and the UI says so. */
export const MAX_PAGES = 100
export const LIMIT_EXCEEDED = 'LIMIT_EXCEEDED'

/**
 * Walks every page of a list endpoint (tree and select data needs the whole set). Never returns
 * a silently truncated list: past `maxPages` it fails with LIMIT_EXCEEDED.
 */
export async function fetchAll<T>(
  path: string,
  params: Params = {},
  signal?: AbortSignal,
  maxPages: number = MAX_PAGES,
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; ; page += 1) {
    const res = await platform.http.get<ListResponse<T>>(path, {
      params: { ...params, page, per_page: PER_PAGE },
      signal,
    })
    rows.push(...res.data)
    const last = res.meta?.pagination?.last_page
    // Without paging meta a full page means there may be more.
    const done = last !== undefined ? page >= last : res.data.length < PER_PAGE
    if (done || res.data.length === 0) return rows
    if (page >= maxPages) {
      throw new ApiError(0, LIMIT_EXCEEDED, `More than ${maxPages * PER_PAGE} records.`)
    }
  }
}

export interface CrudApi<T, I> {
  list: (query: ListQueryState, signal?: AbortSignal) => Promise<ListResponse<T>>
  all: (params?: Params, signal?: AbortSignal) => Promise<T[]>
  create: (input: I, idempotencyKey?: string) => Promise<T>
  update: (id: string, version: number, patch: Partial<I>) => Promise<T>
  /** DELETE requires the record version (optimistic lock); it travels as a query parameter. */
  remove: (id: string, version: number) => Promise<void>
  get: (id: string, signal?: AbortSignal) => Promise<T>
}

/** Standard collection resource: list/create/update (PATCH with `version`)/delete. */
export function createCrudApi<T, I>(path: string): CrudApi<T, I> {
  const item = (id: string) => `${path}/${encodeURIComponent(id)}`
  return {
    list: (query, signal) =>
      platform.http.get<ListResponse<T>>(path, { params: toListParams(query), signal }),
    all: (params, signal) => fetchAll<T>(path, params, signal),
    get: async (id, signal) =>
      (await platform.http.get<ItemResponse<T>>(item(id), { signal })).data,
    create: async (input, key) =>
      (await platform.http.post<ItemResponse<T>>(path, input, withIdempotency({}, key))).data,
    update: async (id, version, patch) =>
      (await platform.http.patch<ItemResponse<T>>(item(id), { ...patch, version })).data,
    remove: async (id, version) => {
      await platform.http.delete<unknown>(item(id), { params: { version } })
    },
  }
}
