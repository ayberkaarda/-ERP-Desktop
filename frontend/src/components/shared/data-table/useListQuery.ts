import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  clampPerPage,
  DEFAULT_LIST_QUERY,
  fromSearchParams,
  isListQueryParam,
  toSearchParams,
  updateListQuery,
  type ListQueryState,
} from './listQuery'
import { readSavedView } from './useSavedView'

export interface ListQueryOptions {
  /** Same key as DataTable `viewKey`: the saved sort and page size seed the initial state. */
  viewKey?: string
}

/** Precedence: URL params (url hook only) > saved view > code defaults. */
function initialBase(defaults: Partial<ListQueryState> | undefined, viewKey: string | undefined) {
  const base: ListQueryState = { ...DEFAULT_LIST_QUERY, ...defaults }
  if (!viewKey) return base
  const view = readSavedView(viewKey)
  if (view.sort) base.sort = view.sort
  if (view.perPage !== undefined) base.perPage = clampPerPage(view.perPage)
  return base
}

/** In-memory list state (dialogs, embedded lists). */
export function useListQuery(defaults?: Partial<ListQueryState>, options: ListQueryOptions = {}) {
  const [query, setQuery] = useState<ListQueryState>(() => initialBase(defaults, options.viewKey))
  const update = useCallback((next: ListQueryState) => setQuery(next), [])
  const patch = useCallback(
    (change: Partial<ListQueryState>) => setQuery((prev) => updateListQuery(prev, change)),
    [],
  )
  return { query, setQuery: update, patch }
}

/** List state kept in the URL, so filters survive reloads and links can be shared. */
export function useUrlListQuery(
  defaults?: Partial<ListQueryState>,
  options: ListQueryOptions = {},
) {
  const [params, setParams] = useSearchParams()
  // Defaults are config, and the saved view is read once: the base must stay stable so a link's
  // meaning does not shift while the user edits the view.
  const [base] = useState(() => initialBase(defaults, options.viewKey))
  const query = useMemo(() => fromSearchParams(params, base), [params, base])
  const setQuery = useCallback(
    (next: ListQueryState) =>
      setParams(
        (prev) => {
          // Only table-owned keys are rewritten; other params (tabs, dialogs) are kept.
          const out = new URLSearchParams()
          for (const [key, value] of prev) if (!isListQueryParam(key)) out.append(key, value)
          for (const [key, value] of toSearchParams(next, base)) out.append(key, value)
          return out
        },
        { replace: true },
      ),
    [setParams, base],
  )
  const patch = useCallback(
    (change: Partial<ListQueryState>) => setQuery(updateListQuery(query, change)),
    [setQuery, query],
  )
  return { query, setQuery, patch }
}
