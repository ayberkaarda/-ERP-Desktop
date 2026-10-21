import { useCallback, useState } from 'react'

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

export function readPresets(key: string, allowed?: readonly string[]): Preset[] {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw ? sanitizePresets(JSON.parse(raw), allowed) : []
  } catch {
    return []
  }
}

function write(key: string, list: Preset[]) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(list))
  } catch {
    // Storage blocked: presets live for this session only.
  }
}

export function usePresets(key: string, allowed?: readonly string[]) {
  const [list, setList] = useState(() => readPresets(key, allowed))
  const save = useCallback(
    (entry: Preset) =>
      setList((prev) => {
        const clean = { name: entry.name.trim().slice(0, MAX_NAME), params: entry.params }
        const next = [clean, ...prev.filter((p) => p.name !== clean.name)].slice(0, MAX)
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
