import { useState } from 'react'
import { createIdempotencyKey } from '@/platform'

/** JSON with object keys sorted, so equal payloads always serialize the same way. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return value === undefined ? 'null' : JSON.stringify(value)
}

/**
 * Idempotency keys bound to the payload: an identical retry (after a lost response) reuses the
 * key so the API replays; a changed payload gets a new key instead of a key-reuse error.
 */
export function createPayloadKeys(newKey: () => string = createIdempotencyKey) {
  let last: { body: string; key: string } | null = null
  return (payload: unknown): string => {
    const body = stableStringify(payload)
    if (last?.body !== body) last = { body, key: newKey() }
    return last.key
  }
}

/** One key sequence per component instance (dialog opening). */
export function usePayloadKeys(): (payload: unknown) => string {
  const [keys] = useState(() => createPayloadKeys())
  return keys
}
