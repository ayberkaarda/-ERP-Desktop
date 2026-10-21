import { useCallback, useState } from 'react'

/** A named filter preset ("Aktif lot takipli stoklar") kept per user in this browser. */
export interface SavedFilter {
  name: string
  q: string
  filters: Record<string, string>
}

const PREFIX = 'keystone.filters.'
const MAX = 20

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'string')
  )
}

/** Stored JSON is untrusted: keep only well-formed entries. */
export function sanitizeFilters(raw: unknown): SavedFilter[] {
  if (!Array.isArray(raw)) return []
  const out: SavedFilter[] = []
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.name !== 'string' || e.name.trim() === '') continue
    out.push({
      name: e.name.slice(0, 80),
      q: typeof e.q === 'string' ? e.q : '',
      filters: isStringRecord(e.filters) ? Object.fromEntries(Object.entries(e.filters)) : {},
    })
  }
  return out.slice(0, MAX)
}

export function readSavedFilters(key: string): SavedFilter[] {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw ? sanitizeFilters(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function write(key: string, list: SavedFilter[]) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(list))
  } catch {
    // Storage blocked: presets live for this session only.
  }
}

export function useSavedFilters(key: string) {
  const [list, setList] = useState(() => readSavedFilters(key))
  const save = useCallback(
    (entry: SavedFilter) =>
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
