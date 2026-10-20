import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  DEFAULT_LIST_QUERY,
  fromSearchParams,
  toSearchParams,
  updateListQuery,
  type ListQueryState,
} from './listQuery'

function withDefaults(defaults?: Partial<ListQueryState>): ListQueryState {
  return { ...DEFAULT_LIST_QUERY, ...defaults }
}

/** In-memory list state (dialogs, embedded lists). */
export function useListQuery(defaults?: Partial<ListQueryState>) {
  const [query, setQuery] = useState<ListQueryState>(() => withDefaults(defaults))
  const update = useCallback((next: ListQueryState) => setQuery(next), [])
  const patch = useCallback(
    (change: Partial<ListQueryState>) => setQuery((prev) => updateListQuery(prev, change)),
    [],
  )
  return { query, setQuery: update, patch }
}

/** List state kept in the URL, so filters survive reloads and links can be shared. */
export function useUrlListQuery(defaults?: Partial<ListQueryState>) {
  const [params, setParams] = useSearchParams()
  // Defaults are config: compare by content so a fresh object literal does not reset state.
  const defaultsKey = JSON.stringify(defaults ?? {})
  const base = useMemo(
    () => withDefaults(JSON.parse(defaultsKey) as Partial<ListQueryState>),
    [defaultsKey],
  )
  const query = useMemo(() => fromSearchParams(params, base), [params, base])
  const setQuery = useCallback(
    (next: ListQueryState) => setParams(toSearchParams(next, base), { replace: true }),
    [setParams, base],
  )
  const patch = useCallback(
    (change: Partial<ListQueryState>) => setQuery(updateListQuery(query, change)),
    [setQuery, query],
  )
  return { query, setQuery, patch }
}
