import { useCallback, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'

/**
 * Scope of saved views for the signed-in user in the active company; null (memory only, never
 * shared between users or companies) when either is missing.
 */
export function viewScope(
  page: string,
  userId: string | null | undefined,
  companyId: string | null | undefined,
): string | null {
  if (!userId || !companyId) return null
  return `sales.${encodeURIComponent(userId)}.${encodeURIComponent(companyId)}.${page}`
}

/** DataTable view key (columns, density, sort, page size) of a page for this user+company. */
export function useScopedViewKey(page: string): string | undefined {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const companyId = useCompanyStore((s) => s.activeCompanyId)
  return viewScope(page, userId, companyId) ?? undefined
}

/** A named filter set ("Bu ayın açık siparişleri"), flat string params. */
export interface SavedFilter {
  name: string
  params: Record<string, string>
}

const PREFIX = 'keystone.presets.'
const MAX = 20
const MAX_NAME = 80

/** Stored JSON is untrusted: keep only well-formed entries with allowed keys and string values. */
export function sanitizeFilters(raw: unknown, allowed: readonly string[]): SavedFilter[] {
  if (!Array.isArray(raw)) return []
  const out: SavedFilter[] = []
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.name !== 'string' || e.name.trim() === '') continue
    if (out.some((p) => p.name === e.name)) continue
    const params: Record<string, string> = {}
    if (typeof e.params === 'object' && e.params !== null && !Array.isArray(e.params)) {
      for (const [k, v] of Object.entries(e.params as Record<string, unknown>)) {
        if (allowed.includes(k) && typeof v === 'string') params[k] = v
      }
    }
    out.push({ name: e.name.slice(0, MAX_NAME), params })
  }
  return out.slice(0, MAX)
}

function read(key: string | null, allowed: readonly string[]): SavedFilter[] {
  if (!key) return []
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw ? sanitizeFilters(JSON.parse(raw), allowed) : []
  } catch {
    return []
  }
}

function write(key: string | null, list: SavedFilter[]) {
  if (!key) return
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(list))
  } catch {
    // Storage blocked: the list lives for this session only.
  }
}

/** Saved filter sets of one list page; reloads when the user or company changes. */
export function useSavedFilters(page: string, allowed: readonly string[]) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const companyId = useCompanyStore((s) => s.activeCompanyId)
  const key = viewScope(page, userId, companyId)
  const [state, setState] = useState(() => ({ key, list: read(key, allowed) }))
  let current = state
  if (state.key !== key) {
    current = { key, list: read(key, allowed) }
    setState(current)
  }
  const save = useCallback(
    (entry: SavedFilter) =>
      setState((prev) => {
        const clean = { name: entry.name.trim().slice(0, MAX_NAME), params: entry.params }
        const list = [clean, ...prev.list.filter((p) => p.name !== clean.name)].slice(0, MAX)
        write(prev.key, list)
        return { ...prev, list }
      }),
    [],
  )
  const remove = useCallback(
    (name: string) =>
      setState((prev) => {
        const list = prev.list.filter((p) => p.name !== name)
        write(prev.key, list)
        return { ...prev, list }
      }),
    [],
  )
  return { list: current.list, save, remove }
}
