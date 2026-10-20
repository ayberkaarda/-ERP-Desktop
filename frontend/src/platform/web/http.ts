import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { ApiError, type ApiErrorBody, type HttpClient, type HttpRequestOptions } from '../types'

export interface WebHttpOptions {
  baseURL?: string
  getCompanyId?: () => string | null
  getLocale?: () => string
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'errors' in value &&
    typeof (value as ApiErrorBody).errors.message === 'string'
  )
}

function toApiError(error: unknown): ApiError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0
    const body: unknown = error.response?.data
    if (isErrorBody(body)) {
      return new ApiError(status, body.errors.code, body.errors.message, body.errors.fields)
    }
    return new ApiError(status, status === 0 ? 'NETWORK_ERROR' : 'HTTP_ERROR', error.message)
  }
  return new ApiError(0, 'UNKNOWN', error instanceof Error ? error.message : String(error))
}

export function createWebHttp(options: WebHttpOptions = {}): HttpClient & { axios: AxiosInstance } {
  const instance = axios.create({
    baseURL: options.baseURL ?? '/api/v1',
    // Sanctum SPA auth rides on the session cookie plus XSRF-TOKEN.
    withCredentials: true,
    withXSRFToken: true,
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

  async function run<T>(request: Promise<{ data: T }>): Promise<T> {
    try {
      return (await request).data
    } catch (error) {
      throw toApiError(error)
    }
  }

  return {
    axios: instance,
    get: (url, o) => run(instance.get(url, toConfig(o))),
    post: (url, body, o) => run(instance.post(url, body, toConfig(o))),
    put: (url, body, o) => run(instance.put(url, body, toConfig(o))),
    patch: (url, body, o) => run(instance.patch(url, body, toConfig(o))),
    delete: (url, o) => run(instance.delete(url, toConfig(o))),
  }
}
