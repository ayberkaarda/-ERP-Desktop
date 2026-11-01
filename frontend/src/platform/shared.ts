// Transport-free helpers every runtime adapter shares. Nothing here may import a network
// client: the desktop build reaches this module without the web adapter.
import { ApiError, type AuthFailure, type HttpRequestOptions } from './types'

export const STALE_REQUEST = 'REQUEST_STALE'

/** A request dropped because the company or session changed before its CSRF replay. */
export function isStaleRequest(error: unknown): boolean {
  return error instanceof ApiError && error.code === STALE_REQUEST
}

// Scheme ("https:", "javascript:") or protocol-relative ("//host") targets leave the API origin.
const ABSOLUTE_URL = /^(?:[a-z][a-z\d+.-]*:|[\\/]{2})/i

export function assertApiPath(url: string): void {
  if (ABSOLUTE_URL.test(url.trim())) {
    throw new ApiError(0, 'INVALID_URL', 'Only paths relative to the API base are allowed.')
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `errors.fields` reduced to string messages per field; anything else is dropped. */
export function readFields(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {}
  const fields: Record<string, string[]> = {}
  for (const [key, messages] of Object.entries(value)) {
    if (Array.isArray(messages)) {
      fields[key] = messages.filter((m): m is string => typeof m === 'string')
    } else if (typeof messages === 'string') {
      fields[key] = [messages]
    }
  }
  return fields
}

/**
 * Reads the API error envelope `{errors: {message, code, fields?, details?}}`. Returns null
 * when the body is not one (gateway page, empty body), so the caller picks its own fallback.
 */
export function apiErrorFromEnvelope(status: number, body: unknown): ApiError | null {
  const errors = isRecord(body) ? body.errors : undefined
  if (!isRecord(errors) || typeof errors.message !== 'string') return null
  const code = typeof errors.code === 'string' ? errors.code : 'HTTP_ERROR'
  const details = isRecord(errors.details) ? errors.details : {}
  return new ApiError(status, code, errors.message, readFields(errors.fields), details)
}

/** Maps a failed response to the session failure it signals, if any. */
export function classifyAuthFailure(status: number, code: string): AuthFailure | null {
  if (status === 401) return 'unauthenticated'
  if (status === 403 && code === 'USER_DEACTIVATED') return 'deactivated'
  if (status === 403 && code === 'PASSWORD_CHANGE_REQUIRED') return 'passwordChangeRequired'
  return null
}

function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // randomUUID is missing outside secure contexts; build a v4 by hand.
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createIdempotencyKey(): string {
  return randomUuid()
}

/**
 * Adds an Idempotency-Key to request options. Reuse the same key when retrying the same
 * logical submit so the API can replay instead of creating a duplicate.
 */
export function withIdempotency(
  options: HttpRequestOptions = {},
  key: string = createIdempotencyKey(),
): HttpRequestOptions {
  return { ...options, idempotencyKey: key }
}

const MAX_FILENAME = 200
// Control characters, path separators and characters Windows refuses in file names.
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME = /[\u0000-\u001f\u007f/\\:*?"<>|]/g

/**
 * File name from a Content-Disposition header (RFC 6266: `filename*` wins over `filename`),
 * reduced to a bare, safe name: no directories, control characters or leading dots.
 */
export function filenameFromDisposition(header: string): string | null {
  let raw: string | null = null
  const extended = /filename\*\s*=\s*([^;]+)/i.exec(header)?.[1]?.trim()
  if (extended) {
    const m = /^([\w!#$%&+^`{}~-]+)'[^']*'(.*)$/.exec(extended.replace(/^"|"$/g, ''))
    if (m?.[1] && m[2] !== undefined && /^utf-8$/i.test(m[1])) {
      try {
        raw = decodeURIComponent(m[2])
      } catch {
        raw = null
      }
    }
  }
  if (raw === null) {
    const plain = /filename\s*=\s*("(?:[^"\\]|\\.)*"|[^;]*)/i.exec(header)?.[1]?.trim()
    if (plain) raw = plain.startsWith('"') ? plain.slice(1, -1).replace(/\\(.)/g, '$1') : plain
  }
  if (raw === null) return null
  const base = raw.split(/[/\\]/).pop() ?? ''
  const clean = base
    .replace(UNSAFE_FILENAME, '_')
    .replace(/^[.\s]+/, '')
    .trim()
  return clean === '' ? null : clean.slice(0, MAX_FILENAME)
}
