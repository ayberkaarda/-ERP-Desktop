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

/** Key for a payload; `reset()` after a success so the next identical request is a new one. */
export type PayloadKeys = ((payload: unknown) => string) & { reset: () => void }

/**
 * Idempotency keys bound to the payload: an identical retry (after a lost response) reuses the
 * key so the API replays; a changed payload gets a new key instead of a 422 key-reuse error.
 * Call `reset()` once a request succeeded, otherwise a deliberate repeat would be replayed.
 */
export function createPayloadKeys(newKey: () => string = createIdempotencyKey): PayloadKeys {
  let last: { body: string; key: string } | null = null
  const keyFor = (payload: unknown): string => {
    const body = stableStringify(payload)
    if (last?.body !== body) last = { body, key: newKey() }
    return last.key
  }
  return Object.assign(keyFor, {
    reset: () => {
      last = null
    },
  })
}

/** One key sequence per component instance (editor page, dialog). */
export function usePayloadKeys(): PayloadKeys {
  const [keys] = useState(() => createPayloadKeys())
  return keys
}
