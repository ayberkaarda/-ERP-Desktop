// List state <-> backend ListQuery params (page, per_page<=100, sort=-col, filter[x], q).

export interface SortItem {
  id: string
  desc: boolean
}

export interface ListQueryState {
  page: number
  perPage: number
  sort: SortItem[]
  filters: Record<string, string>
  q: string
}

export const MAX_PER_PAGE = 100
export const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const

export const DEFAULT_LIST_QUERY: ListQueryState = {
  page: 1,
  perPage: 25,
  sort: [],
  filters: {},
  q: '',
}

export function clampPerPage(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIST_QUERY.perPage
  return Math.min(MAX_PER_PAGE, Math.max(1, Math.trunc(value)))
}

function clampPage(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.trunc(value) : 1
}

export function serializeSort(sort: readonly SortItem[]): string {
  return sort.map((s) => (s.desc ? `-${s.id}` : s.id)).join(',')
}

export function parseSort(value: string | null | undefined): SortItem[] {
  if (!value) return []
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part.startsWith('-') ? { id: part.slice(1), desc: true } : { id: part, desc: false },
    )
    .filter((s) => s.id !== '')
}

/** Query params for platform.http (`params` option); empty values are left out. */
export function toListParams(state: ListQueryState): Record<string, string | number> {
  const params: Record<string, string | number> = {
    page: clampPage(state.page),
    per_page: clampPerPage(state.perPage),
  }
  const sort = serializeSort(state.sort)
  if (sort) params.sort = sort
  const q = state.q.trim()
  if (q) params.q = q
  for (const [key, value] of Object.entries(state.filters)) {
    if (value !== '') params[`filter[${key}]`] = value
  }
  return params
}

/** URL form of the state; values equal to `defaults` are omitted to keep links short. */
export function toSearchParams(
  state: ListQueryState,
  defaults: ListQueryState = DEFAULT_LIST_QUERY,
): URLSearchParams {
  const out = new URLSearchParams()
  for (const [key, value] of Object.entries(toListParams(state))) {
    const isDefault =
      (key === 'page' && value === defaults.page) ||
      (key === 'per_page' && value === defaults.perPage) ||
      (key === 'sort' && value === serializeSort(defaults.sort))
    if (!isDefault) out.set(key, String(value))
  }
  return out
}

export function fromSearchParams(
  params: URLSearchParams,
  defaults: ListQueryState = DEFAULT_LIST_QUERY,
): ListQueryState {
  const filters: Record<string, string> = {}
  for (const [key, value] of params) {
    const m = /^filter\[([^\]]+)\]$/.exec(key)
    if (m?.[1] && value !== '') filters[m[1]] = value
  }
  const page = params.get('page')
  const perPage = params.get('per_page')
  return {
    page: page ? clampPage(Number(page)) : defaults.page,
    perPage: perPage ? clampPerPage(Number(perPage)) : defaults.perPage,
    sort: params.has('sort') ? parseSort(params.get('sort')) : defaults.sort,
    filters: Object.keys(filters).length ? filters : defaults.filters,
    q: params.get('q') ?? defaults.q,
  }
}

/** Applies a change; anything other than a page move sends the user back to page 1. */
export function updateListQuery(
  prev: ListQueryState,
  patch: Partial<ListQueryState>,
): ListQueryState {
  const next: ListQueryState = { ...prev, ...patch }
  next.perPage = clampPerPage(next.perPage)
  const onlyPage = Object.keys(patch).every((k) => k === 'page')
  next.page = onlyPage ? clampPage(next.page) : 1
  return next
}

export function setFilter(
  prev: ListQueryState,
  key: string,
  value: string | null | undefined,
): ListQueryState {
  const filters = Object.fromEntries(Object.entries(prev.filters).filter(([k]) => k !== key))
  if (value !== null && value !== undefined && value !== '') filters[key] = value
  return updateListQuery(prev, { filters })
}

export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / clampPerPage(perPage)))
}
