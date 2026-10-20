import axios, { type AxiosRequestConfig } from 'axios'
import { ApiError, type AuthFailure, type HttpClient, type HttpRequestOptions } from '../types'

declare module 'axios' {
  interface AxiosRequestConfig {
    skipAuthHandling?: boolean
    csrfRetried?: boolean
  }
}

export interface WebHttpOptions {
  baseURL?: string
  /** Sanctum CSRF endpoint, outside the API base. */
  csrfPath?: string
  getCompanyId?: () => string | null
  getLocale?: () => string
  onAuthFailure?: (failure: AuthFailure) => void
}

// Scheme ("https:", "javascript:") or protocol-relative ("//host") targets leave the API origin.
const ABSOLUTE_URL = /^(?:[a-z][a-z\d+.-]*:|[\\/]{2})/i

export function assertApiPath(url: string): void {
  if (ABSOLUTE_URL.test(url.trim())) {
    throw new ApiError(0, 'INVALID_URL', 'Only paths relative to the API base are allowed.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readFields(value: unknown): Record<string, string[]> {
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

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0
    const body: unknown = error.response?.data
    const errors = isRecord(body) ? body.errors : undefined
    if (isRecord(errors) && typeof errors.message === 'string') {
      const code = typeof errors.code === 'string' ? errors.code : 'HTTP_ERROR'
      return new ApiError(status, code, errors.message, readFields(errors.fields))
    }
    return new ApiError(status, status === 0 ? 'NETWORK_ERROR' : 'HTTP_ERROR', error.message)
  }
  return new ApiError(0, 'UNKNOWN', error instanceof Error ? error.message : String(error))
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

export function createWebHttp(options: WebHttpOptions = {}): HttpClient {
  const instance = axios.create({
    baseURL: options.baseURL ?? '/api/v1',
    allowAbsoluteUrls: false,
    // Sanctum SPA auth rides on the session cookie plus XSRF-TOKEN. The API is served from the
    // same origin (Vite proxy in dev, reverse proxy in prod); XSRF is left at axios' default,
    // which only attaches it to same-origin requests.
    withCredentials: true,
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  })

  const csrfPath = options.csrfPath ?? '/sanctum/csrf-cookie'
  let csrfInFlight: Promise<void> | null = null

  // Concurrent 419s share one cookie refresh.
  function refreshCsrf(): Promise<void> {
    csrfInFlight ??= instance
      .get(csrfPath, { baseURL: '/', skipAuthHandling: true })
      .then(() => undefined)
      .finally(() => {
        csrfInFlight = null
      })
    return csrfInFlight
  }

  instance.interceptors.request.use((config) => {
    const companyId = options.getCompanyId?.()
    if (companyId) config.headers.set('X-Company-Id', companyId)
    const locale = options.getLocale?.()
    if (locale) config.headers.set('Accept-Language', locale)
    return config
  })

  instance.interceptors.response.use(undefined, async (error: unknown) => {
    if (!axios.isAxiosError(error) || !error.config) throw error
    const config = error.config
    const status = error.response?.status ?? 0

    // Expired CSRF token: refresh the cookie and replay the original request exactly once.
    if (status === 419 && !config.csrfRetried) {
      config.csrfRetried = true
      await refreshCsrf()
      return instance.request(config)
    }

    if (!config.skipAuthHandling) {
      const failure = classifyAuthFailure(status, toApiError(error).code)
      if (failure) options.onAuthFailure?.(failure)
    }
    throw error
  })

  const toConfig = (o: HttpRequestOptions = {}): AxiosRequestConfig => ({
    params: o.params,
    signal: o.signal,
    skipAuthHandling: o.skipAuthHandling,
    data: o.body,
    headers: o.idempotencyKey ? { ...o.headers, 'Idempotency-Key': o.idempotencyKey } : o.headers,
  })

  async function run<T>(url: string, send: () => Promise<{ data: T }>): Promise<T> {
    try {
      assertApiPath(url)
      return (await send()).data
    } catch (error) {
      throw toApiError(error)
    }
  }

  return {
    get: (url, o) => run(url, () => instance.get(url, toConfig(o))),
    post: (url, body, o) => run(url, () => instance.post(url, body, toConfig(o))),
    put: (url, body, o) => run(url, () => instance.put(url, body, toConfig(o))),
    patch: (url, body, o) => run(url, () => instance.patch(url, body, toConfig(o))),
    delete: (url, o) => run(url, () => instance.delete(url, toConfig(o))),
    prepareSession: async () => {
      try {
        await refreshCsrf()
      } catch (error) {
        throw toApiError(error)
      }
    },
  }
}
