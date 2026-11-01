// TEMPORARY: removed after the upstream sync that brings the web platform
// runtime hook (Keystone-ERP #74, branch feat/platform-runtime-hook, 19605ac).
// Then every import of this file moves to `@/platform/shared` (helpers) and
// `@/platform/types` (types, ApiError), and this file and its test are deleted.
//
// The helpers below are a verbatim copy of the U1 `frontend/src/platform/shared.ts`
// (same signatures, same behaviour). The frontend in this repository is still the
// older web code: it has no `shared.ts`, and its `types.ts` lacks `PlatformSession`,
// `Platform.session` and `PlatformDeps`. Those three are declared here as local
// types with the U1 shape; everything else comes from the frontend `types.ts`
// itself, so `ApiError` stays the one class the features check with `instanceof`.

import { ApiError, type AuthFailure, type HttpRequestOptions } from '../../../../frontend/src/platform/types'
import type { Platform as WebPlatform } from '../../../../frontend/src/platform/types'

export {
  ApiError,
  isApiError,
  type AuthFailure,
  type Connectivity,
  type DownloadResult,
  type HttpClient,
  type HttpRequestOptions,
  type Notify,
  type NotifyOptions,
  type Realtime,
  type RealtimeState,
  type SubscriptionStatus,
} from '../../../../frontend/src/platform/types'

// --- Local types with the U1 `types.ts` shape (missing in the older frontend) ---

/**
 * Account flows a runtime owns itself instead of the web's cookie-session endpoints.
 * Absent on web: callers fall back to the HTTP flows.
 */
export interface PlatformSession {
  /** Ends the session on the server side of this runtime; rejects when it did not confirm. */
  logout(): Promise<void>
  /** Makes `id` the active company in this runtime; rejecting keeps the current company. */
  switchCompany(id: string): Promise<void>
  /** 'external': passwords (and 2FA, sessions) are managed outside this app. */
  passwordChange: 'inline' | 'external'
}

export interface Platform extends WebPlatform {
  session?: PlatformSession
}

/** What the app hands the runtime module (platform/runtime.ts) to build its Platform. */
export interface PlatformDeps {
  getCompanyId: () => string | null
  getLocale: () => string
  /** Bumped on every sign-in/sign-out; work from an older session must not replay. */
  getSessionGeneration: () => number
  onAuthFailure: (failure: AuthFailure) => void
}

// --- Verbatim copy of U1 frontend/src/platform/shared.ts ---

export const STALE_REQUEST = 'REQUEST_STALE'

/**
 * A runtime rejects with this when the user called off a session action it asked about
 * (e.g. pending work on sign-out or company switch). Callers keep the current state and
 * show nothing; any other rejection is a real error.
 */
export class PlatformCancelledError extends Error {
  constructor(message = 'Cancelled by the user.') {
    super(message)
    this.name = 'PlatformCancelled'
  }
}

/** True for PlatformCancelledError, also from another copy of this module (matched by name). */
export function isPlatformCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'PlatformCancelled'
}

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
