import { useCallback, useState } from 'react'
import type { SortItem } from './listQuery'

export type Density = 'comfortable' | 'compact'

/** Per-user table preferences for one resource ("sales.invoices"). */
export interface SavedView {
  columnVisibility: Record<string, boolean>
  columnSizing: Record<string, number>
  density: Density
  perPage?: number
  sort?: SortItem[]
}

export const EMPTY_VIEW: SavedView = {
  columnVisibility: {},
  columnSizing: {},
  density: 'comfortable',
}

const PREFIX = 'keystone.view.'

function isRecordOf<T>(value: unknown, check: (v: unknown) => v is T): value is Record<string, T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(check)
  )
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Stored JSON is untrusted (older versions, manual edits): keep only well-formed parts. */
export function sanitizeView(raw: unknown): SavedView {
  if (typeof raw !== 'object' || raw === null) return EMPTY_VIEW
  const r = raw as Record<string, unknown>
  const view: SavedView = {
    columnVisibility: isRecordOf(r.columnVisibility, isBool) ? r.columnVisibility : {},
    columnSizing: isRecordOf(r.columnSizing, isNum) ? r.columnSizing : {},
    density: r.density === 'compact' ? 'compact' : 'comfortable',
  }
  if (isNum(r.perPage)) view.perPage = r.perPage
  if (
    Array.isArray(r.sort) &&
    r.sort.every(
      (s: unknown) =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as SortItem).id === 'string' &&
        typeof (s as SortItem).desc === 'boolean',
    )
  ) {
    view.sort = r.sort as SortItem[]
  }
  return view
}

function read(key: string | null): SavedView {
  if (!key) return EMPTY_VIEW
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw ? sanitizeView(JSON.parse(raw)) : EMPTY_VIEW
  } catch {
    return EMPTY_VIEW
  }
}

function write(key: string, view: SavedView | null): void {
  try {
    if (view) window.localStorage.setItem(PREFIX + key, JSON.stringify(view))
    else window.localStorage.removeItem(PREFIX + key)
  } catch {
    // Storage blocked or full: the view still applies for this session.
  }
}

/** Saved table view; `null` key keeps it in memory only. */
export function useSavedView(resourceKey: string | null) {
  const [state, setState] = useState(() => ({ key: resourceKey, view: read(resourceKey) }))
  // Switching resource (same component, new key) loads that resource's view.
  let current = state.view
  if (state.key !== resourceKey) {
    current = read(resourceKey)
    setState({ key: resourceKey, view: current })
  }

  const update = useCallback(
    (patch: Partial<SavedView> | ((prev: SavedView) => Partial<SavedView>)) => {
      setState((prev) => {
        const base = prev.key === resourceKey ? prev.view : read(resourceKey)
        const next = { ...base, ...(typeof patch === 'function' ? patch(base) : patch) }
        if (resourceKey) write(resourceKey, next)
        return { key: resourceKey, view: next }
      })
    },
    [resourceKey],
  )

  const reset = useCallback(() => {
    if (resourceKey) write(resourceKey, null)
    setState({ key: resourceKey, view: EMPTY_VIEW })
  }, [resourceKey])

  return { view: current, update, reset }
}
