import axios, { type AxiosRequestConfig } from 'axios'
import {
  apiErrorFromEnvelope,
  assertApiPath,
  classifyAuthFailure,
  filenameFromDisposition,
  isRecord,
  STALE_REQUEST,
} from '../shared'
import {
  ApiError,
  type AuthFailure,
  type DownloadResult,
  type HttpClient,
  type HttpRequestOptions,
} from '../types'

// Moved to ../shared (transport-free); re-exported so existing imports keep working.
export {
  assertApiPath,
  classifyAuthFailure,
  createIdempotencyKey,
  filenameFromDisposition,
  isStaleRequest,
  STALE_REQUEST,
  withIdempotency,
} from '../shared'

declare module 'axios' {
  interface AxiosRequestConfig {
    skipAuthHandling?: boolean
    csrfRetried?: boolean
    csrfRefresh?: boolean
    sentCompanyId?: string | null
    sentGeneration?: number
  }
}

export interface WebHttpOptions {
  baseURL?: string
  /** Sanctum CSRF endpoint, outside the API base. */
  csrfPath?: string
  getCompanyId?: () => string | null
  getLocale?: () => string
  /** Bumped on every sign-in/sign-out; a replay from an older session is refused. */
  getSessionGeneration?: () => number
  onAuthFailure?: (failure: AuthFailure) => void
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0
    return (
      apiErrorFromEnvelope(status, error.response?.data) ??
      new ApiError(status, status === 0 ? 'NETWORK_ERROR' : 'HTTP_ERROR', error.message)
    )
  }
  return new ApiError(0, 'UNKNOWN', error instanceof Error ? error.message : String(error))
}

/** Replaces a Blob error body with its parsed JSON so the error envelope can be read. */
async function readBlobError(error: { response?: { data?: unknown } }): Promise<void> {
  const data = error.response?.data
  if (!(data instanceof Blob) || error.response === undefined) return
  try {
    error.response.data = JSON.parse(await data.text()) as unknown
  } catch {
    // Not JSON (HTML gateway page): keep the generic HTTP error.
  }
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
      .get(csrfPath, { baseURL: '/', skipAuthHandling: true, csrfRefresh: true })
      .then(() => undefined)
      .finally(() => {
        csrfInFlight = null
      })
    return csrfInFlight
  }

  const currentCompany = () => options.getCompanyId?.() ?? null
  const currentGeneration = () => options.getSessionGeneration?.() ?? 0

  instance.interceptors.request.use((config) => {
    const companyId = currentCompany()
    // Remember the context of the first send; a replay must happen in the same one.
    if (!config.csrfRetried) {
      config.sentCompanyId = companyId
      config.sentGeneration = currentGeneration()
    }
    if (companyId) config.headers.set('X-Company-Id', companyId)
    const locale = options.getLocale?.()
    if (locale) config.headers.set('Accept-Language', locale)
    return config
  })

  instance.interceptors.response.use(undefined, async (error: unknown) => {
    if (!axios.isAxiosError(error) || !error.config) throw error
    // Blob downloads get their error envelope as a Blob; read it so codes and fields survive.
    await readBlobError(error)
    const config = error.config
    const status = error.response?.status ?? 0

    // Expired CSRF token: refresh the cookie and replay the original request exactly once.
    // The refresh itself and self-handled requests never recover (a 419 there would wait on
    // its own refresh).
    if (status === 419 && !config.csrfRetried && !config.csrfRefresh && !config.skipAuthHandling) {
      config.csrfRetried = true
      await refreshCsrf()
      if (
        currentCompany() !== (config.sentCompanyId ?? null) ||
        currentGeneration() !== config.sentGeneration
      ) {
        throw new ApiError(0, STALE_REQUEST, 'Company or session changed; request not replayed.')
      }
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
    streamPost: async (url, body, o = {}) => {
      assertApiPath(url)
      const company = currentCompany()
      const generation = currentGeneration()
      const base = options.baseURL ?? '/api/v1'
      const target = `${base.replace(/\/$/, '')}/${url.replace(/^\//, '')}`
      if (!target.startsWith('/') || target.startsWith('//')) {
        throw new ApiError(0, 'INVALID_URL', 'Streaming requires a same-origin API base.')
      }
      const send = () => {
        const locale = options.getLocale?.()
        const csrf = document.cookie
          .split('; ')
          .find((cookie) => cookie.startsWith('XSRF-TOKEN='))
          ?.slice(11)
        const headers: Record<string, string> = {
          ...o.headers,
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(company ? { 'X-Company-Id': company } : {}),
          ...(locale ? { 'Accept-Language': locale } : {}),
          ...(o.idempotencyKey ? { 'Idempotency-Key': o.idempotencyKey } : {}),
          ...(csrf ? { 'X-XSRF-TOKEN': decodeURIComponent(csrf) } : {}),
        }
        return fetch(target, {
          method: 'POST',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify(body),
          signal: o.signal,
          redirect: 'error',
        })
      }
      let response = await send()
      if (company !== currentCompany() || generation !== currentGeneration()) {
        await response.body?.cancel()
        throw new ApiError(0, STALE_REQUEST, 'Company or session changed.')
      }
      if (response.status === 419 && !o.skipAuthHandling) {
        await response.body?.cancel()
        await refreshCsrf()
        if (company !== currentCompany() || generation !== currentGeneration()) {
          throw new ApiError(0, STALE_REQUEST, 'Company or session changed; request not replayed.')
        }
        response = await send()
      }
      if (company !== currentCompany() || generation !== currentGeneration()) {
        await response.body?.cancel()
        throw new ApiError(0, STALE_REQUEST, 'Company or session changed.')
      }
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null)
        if (company !== currentCompany() || generation !== currentGeneration()) {
          throw new ApiError(0, STALE_REQUEST, 'Company or session changed.')
        }
        const errors = isRecord(payload) && isRecord(payload.errors) ? payload.errors : {}
        const code = typeof errors.code === 'string' ? errors.code : 'HTTP_ERROR'
        const failure = classifyAuthFailure(response.status, code)
        if (failure && !o.skipAuthHandling) options.onAuthFailure?.(failure)
        throw new ApiError(
          response.status,
          code,
          typeof errors.message === 'string' ? errors.message : response.statusText,
        )
      }
      if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
        await response.body?.cancel()
        throw new ApiError(0, 'INVALID_STREAM', 'Expected an event stream.')
      }
      return response.body
    },
    get: (url, o) => run(url, () => instance.get(url, toConfig(o))),
    post: (url, body, o) => run(url, () => instance.post(url, body, toConfig(o))),
    put: (url, body, o) => run(url, () => instance.put(url, body, toConfig(o))),
    patch: (url, body, o) => run(url, () => instance.patch(url, body, toConfig(o))),
    delete: (url, o) => run(url, () => instance.delete(url, toConfig(o))),
    download: (url, o) =>
      run<DownloadResult>(url, async () => {
        const res = await instance.get<Blob>(url, { ...toConfig(o), responseType: 'blob' })
        const header: unknown = res.headers['content-disposition']
        return {
          data: {
            blob: res.data,
            filename: typeof header === 'string' ? filenameFromDisposition(header) : null,
          },
        }
      }),
    prepareSession: async () => {
      try {
        await refreshCsrf()
      } catch (error) {
        throw toApiError(error)
      }
    },
  }
}
