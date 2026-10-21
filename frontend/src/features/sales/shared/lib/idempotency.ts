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
 * Idempotency keys bound to the payload: a retry of the same submit (after a lost response or a
 * network error) reuses the key so the API replays instead of creating twice; a changed payload
 * gets a new key. Call `reset()` once a request succeeded.
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

/** Keys of submissions that must outlive the component that sent them. */
export interface KeyStore {
  keyFor: (payload: unknown) => string
  /** After a success: the next identical submission is a new request. */
  release: (payload: unknown) => void
}

/**
 * Payload-bound keys kept at module level: a dialog closed after a lost response and opened
 * again sends the same key for the same payload, so the API replays instead of creating twice.
 */
export function createKeyStore(newKey: () => string = createIdempotencyKey): KeyStore {
  const keys = new Map<string, string>()
  return {
    keyFor: (payload) => {
      const body = stableStringify(payload)
      let key = keys.get(body)
      if (!key) {
        key = newKey()
        keys.set(body, key)
      }
      return key
    },
    release: (payload) => {
      keys.delete(stableStringify(payload))
    },
  }
}
