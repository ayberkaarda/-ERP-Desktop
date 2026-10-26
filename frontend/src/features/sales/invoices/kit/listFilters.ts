import {
  setFilter,
  updateListQuery,
  useUrlListQuery,
  type ListQueryState,
} from '@/components/shared/data-table'
import { useScopedViewKey } from './viewKey'

/** Filters every sales document list offers next to the table's own search and status. */
export const COMMON_FILTERS = ['date_from', 'date_to', 'party_id', 'number', 'item_id'] as const

export interface ListFiltersState {
  /** Page key ("sales.invoices"): saved views and presets are kept per user and company. */
  key: string
  viewKey: string | undefined
  urlQuery: ListQueryState
  query: ListQueryState
  setQuery: (next: ListQueryState) => void
  f: (key: string) => string
  change: (key: string, value: string) => void
  filtered: boolean
  clear: () => void
  presetKeys: readonly string[]
  applyPreset: (params: Record<string, string>) => void
}

/** URL-backed list query with the shared sales filters and per-user/company saved views. */
export function useListFilters(
  key: string,
  defaults: Partial<ListQueryState>,
  extra: readonly string[] = [],
): ListFiltersState {
  const viewKey = useScopedViewKey(key) ?? undefined
  const { query: urlQuery, setQuery } = useUrlListQuery(defaults, { viewKey })
  const names = [...COMMON_FILTERS, ...extra, 'status']
  const f = (k: string) => urlQuery.filters[k] ?? ''
  return {
    key,
    viewKey,
    urlQuery,
    query: urlQuery,
    setQuery,
    f,
    change: (k, value) => setQuery(setFilter(urlQuery, k, value)),
    filtered: names.some((k) => f(k) !== '') || urlQuery.q !== '',
    clear: () => setQuery(updateListQuery(urlQuery, { q: '', filters: {} })),
    presetKeys: ['q', ...names],
    applyPreset: (params) => {
      let next: ListQueryState = updateListQuery(urlQuery, { q: params.q ?? '', filters: {} })
      for (const k of names) if (params[k]) next = setFilter(next, k, params[k])
      setQuery(next)
    },
  }
}
