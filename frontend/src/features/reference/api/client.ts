import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { platform, withIdempotency } from '@/platform'
import type { ItemResponse, ListResponse } from '../types'

type Params = Record<string, string | number | boolean | undefined>

const MAX_PAGES = 20

/** Walks every page of a list endpoint (tree and select data needs the whole set). */
export async function fetchAll<T>(
  path: string,
  params: Params = {},
  signal?: AbortSignal,
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await platform.http.get<ListResponse<T>>(path, {
      params: { ...params, page, per_page: 100 },
      signal,
    })
    rows.push(...res.data)
    const last = res.meta?.last_page ?? 1
    if (page >= last || res.data.length === 0) break
  }
  return rows
}

export interface CrudApi<T, I> {
  list: (query: ListQueryState, signal?: AbortSignal) => Promise<ListResponse<T>>
  all: (params?: Params, signal?: AbortSignal) => Promise<T[]>
  create: (input: I, idempotencyKey?: string) => Promise<T>
  update: (id: string, version: number, patch: Partial<I>) => Promise<T>
  remove: (id: string) => Promise<void>
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
    remove: async (id) => {
      await platform.http.delete<unknown>(item(id))
    },
  }
}
