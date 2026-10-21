import { useCallback, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'

/**
 * A named parameter set ("Ocak mizanı, 3. kırılım") kept per user in this browser: list filters
 * or report parameters, always as flat string records.
 */
export interface Preset {
  name: string
  params: Record<string, string>
}

const PREFIX = 'keystone.presets.'
const MAX = 20
const MAX_NAME = 80

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'string')
  )
}

/** Stored JSON is untrusted: keep only well-formed entries (and only `allowed` keys if given). */
export function sanitizePresets(raw: unknown, allowed?: readonly string[]): Preset[] {
  if (!Array.isArray(raw)) return []
  const out: Preset[] = []
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.name !== 'string' || e.name.trim() === '') continue
    if (out.some((p) => p.name === e.name)) continue
    const params = isStringRecord(e.params)
      ? Object.fromEntries(
          Object.entries(e.params).filter(([k]) => (allowed ? allowed.includes(k) : true)),
        )
      : {}
    out.push({ name: e.name.slice(0, MAX_NAME), params })
  }
  return out.slice(0, MAX)
}

/**
 * Storage key of one page's presets for one user in one company; null without a signed-in user
 * and an active company (presets then live in memory only and are never shared).
 */
export function presetStorageKey(
  key: string,
  userId: string | null | undefined,
  companyId: string | null | undefined,
): string | null {
  if (!userId || !companyId) return null
  return `${PREFIX}${encodeURIComponent(userId)}.${encodeURIComponent(companyId)}.${key}`
}

export function readPresets(storageKey: string | null, allowed?: readonly string[]): Preset[] {
  if (!storageKey) return []
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? sanitizePresets(JSON.parse(raw), allowed) : []
  } catch {
    return []
  }
}

function write(storageKey: string | null, list: Preset[]) {
  if (!storageKey) return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(list))
  } catch {
    // Storage blocked: presets live for this session only.
  }
}

/** Presets of the signed-in user in the active company; reloads when either changes. */
export function usePresets(key: string, allowed?: readonly string[]) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const companyId = useCompanyStore((s) => s.activeCompanyId)
  const storageKey = presetStorageKey(key, userId, companyId)
  const [state, setState] = useState(() => ({
    storageKey,
    list: readPresets(storageKey, allowed),
  }))
  // Another user or company: drop what was shown and read that scope's presets.
  let current = state
  if (state.storageKey !== storageKey) {
    current = { storageKey, list: readPresets(storageKey, allowed) }
    setState(current)
  }
  const save = useCallback(
    (entry: Preset) =>
      setState((prev) => {
        const clean = { name: entry.name.trim().slice(0, MAX_NAME), params: entry.params }
        const list = [clean, ...prev.list.filter((p) => p.name !== clean.name)].slice(0, MAX)
        write(prev.storageKey, list)
        return { ...prev, list }
      }),
    [],
  )
  const remove = useCallback(
    (name: string) =>
      setState((prev) => {
        const list = prev.list.filter((p) => p.name !== name)
        write(prev.storageKey, list)
        return { ...prev, list }
      }),
    [],
  )
  return { list: current.list, save, remove }
}
