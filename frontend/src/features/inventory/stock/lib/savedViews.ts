import { useCallback, useState } from 'react'

/** A named set of page parameters (search, filters, grouping) kept per user in this browser. */
export interface SavedViewEntry {
  name: string
  values: Record<string, string>
}

const PREFIX = 'keystone.inventory.views.'
const MAX = 20

/** Stored JSON is untrusted: keep only well-formed entries. */
export function sanitizeViews(raw: unknown): SavedViewEntry[] {
  if (!Array.isArray(raw)) return []
  const out: SavedViewEntry[] = []
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.name !== 'string' || e.name.trim() === '') continue
    const values =
      typeof e.values === 'object' && e.values !== null && !Array.isArray(e.values)
        ? Object.fromEntries(
            Object.entries(e.values as Record<string, unknown>).filter(
              (kv): kv is [string, string] => typeof kv[1] === 'string',
            ),
          )
        : {}
    out.push({ name: e.name.slice(0, 80), values })
  }
  return out.slice(0, MAX)
}

export function viewStorageKey(key: string): string {
  return PREFIX + key
}

function read(key: string): SavedViewEntry[] {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw ? sanitizeViews(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function write(key: string, list: SavedViewEntry[]) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(list))
  } catch {
    // Storage blocked: views live for this session only.
  }
}

export function useSavedViews(key: string) {
  const [list, setList] = useState(() => read(key))
  const save = useCallback(
    (entry: SavedViewEntry) =>
      setList((prev) => {
        const next = [entry, ...prev.filter((p) => p.name !== entry.name)].slice(0, MAX)
        write(key, next)
        return next
      }),
    [key],
  )
  const remove = useCallback(
    (name: string) =>
      setList((prev) => {
        const next = prev.filter((p) => p.name !== name)
        write(key, next)
        return next
      }),
    [key],
  )
  return { list, save, remove }
}
