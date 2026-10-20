import axios, { type AxiosRequestConfig } from 'axios'
import { ApiError, type HttpClient, type HttpRequestOptions } from '../types'

export interface WebHttpOptions {
  baseURL?: string
  getCompanyId?: () => string | null
  getLocale?: () => string
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

  instance.interceptors.request.use((config) => {
    const companyId = options.getCompanyId?.()
    if (companyId) config.headers.set('X-Company-Id', companyId)
    const locale = options.getLocale?.()
    if (locale) config.headers.set('Accept-Language', locale)
    return config
  })

  const toConfig = (o: HttpRequestOptions = {}): AxiosRequestConfig => ({
    params: o.params,
    signal: o.signal,
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
  }
}
