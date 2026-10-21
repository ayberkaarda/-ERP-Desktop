import { useCallback, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'

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

/**
 * Storage key of one page's views for one user in one company; null without a signed-in user
 * and company (views then live in memory only and are never shared between sessions).
 */
export function viewStorageKey(
  key: string,
  userId: string | null | undefined,
  companyId: string | null | undefined,
): string | null {
  if (!userId || !companyId) return null
  return `${PREFIX}${encodeURIComponent(userId)}.${encodeURIComponent(companyId)}.${key}`
}

function read(storageKey: string | null): SavedViewEntry[] {
  if (!storageKey) return []
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? sanitizeViews(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function write(storageKey: string | null, list: SavedViewEntry[]) {
  if (!storageKey) return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(list))
  } catch {
    // Storage blocked: views live for this session only.
  }
}

/** Saved views of a page for the signed-in user in the active company; reloads on a switch. */
export function useSavedViews(key: string) {
  const userId = useAuthStore((s) => s.user?.id)
  const companyId = useCompanyStore((s) => s.activeCompanyId)
  const storageKey = viewStorageKey(key, userId, companyId)
  const [state, setState] = useState(() => ({ storageKey, list: read(storageKey) }))
  let list = state.list
  if (state.storageKey !== storageKey) {
    // Another user or company: drop the previous list and load this scope's views.
    list = read(storageKey)
    setState({ storageKey, list })
  }
  const update = useCallback(
    (change: (prev: SavedViewEntry[]) => SavedViewEntry[]) =>
      setState((prev) => {
        const base = prev.storageKey === storageKey ? prev.list : read(storageKey)
        const next = change(base)
        write(storageKey, next)
        return { storageKey, list: next }
      }),
    [storageKey],
  )
  const save = useCallback(
    (entry: SavedViewEntry) =>
      update((prev) => [entry, ...prev.filter((p) => p.name !== entry.name)].slice(0, MAX)),
    [update],
  )
  const remove = useCallback(
    (name: string) => update((prev) => prev.filter((p) => p.name !== name)),
    [update],
  )
  return { list, save, remove }
}
