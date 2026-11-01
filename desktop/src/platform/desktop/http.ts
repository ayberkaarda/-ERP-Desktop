// `HttpClient` over the `api_request` command. Requests are mapped the way the
// web axios client sends them; answers and failures come back as the same
// values and `ApiError`s the web client gives, so feature code does not change.

import { apiRequest, header, type ApiMethod, type ApiRequest, type ApiResponse } from '../../bridge/api'
import { toCommandError, type Invoke } from '../../bridge/invoke'
import { commandToApiError } from './errors'
import type { OfflineMeta, OfflineMetaStore } from './offlineMeta'
import {
  ApiError,
  apiErrorFromEnvelope,
  assertApiPath,
  classifyAuthFailure,
  filenameFromDisposition,
  isRecord,
  STALE_REQUEST,
  type DownloadResult,
  type HttpClient,
  type HttpRequestOptions,
  type PlatformDeps,
} from './u1-shim'

export const API_BASE = '/api/v1'

/** What the client tells connectivity about each request. */
export interface NetworkReport {
  /** The shell could not reach the server (`NETWORK_ERROR`). */
  failed(): void
  /** The server answered (any status). */
  answered(): void
}

export interface DesktopHttpOptions {
  invoke: Invoke
  deps: PlatformDeps
  network?: NetworkReport
  offlineMeta?: OfflineMetaStore
}

// Headers the runtime sets itself; a caller's copy is dropped.
const RUNTIME_HEADERS = ['accept-language', 'idempotency-key', 'x-company-id']

class Headers {
  private readonly list: [string, string][] = []

  set(name: string, value: string): void {
    this.remove(name)
    this.list.push([name, value])
  }

  remove(name: string): void {
    const lower = name.toLowerCase()
    for (let i = this.list.length - 1; i >= 0; i -= 1) {
      if (this.list[i]?.[0].toLowerCase() === lower) this.list.splice(i, 1)
    }
  }

  pairs(): [string, string][] {
    return this.list
  }
}

/** `url` without fragment, split into the `/api/v1` path and its query pairs. */
function splitUrl(url: string): { path: string; query: [string, string][] } {
  const noFragment = url.trim().split('#', 1)[0] ?? ''
  const at = noFragment.indexOf('?')
  const relative = at === -1 ? noFragment : noFragment.slice(0, at)
  const query: [string, string][] =
    at === -1 ? [] : [...new URLSearchParams(noFragment.slice(at + 1)).entries()]
  return { path: `/${relative.replace(/^\/+/, '')}`, query }
}

/** One param value as axios writes it (dates as ISO, objects as JSON). */
function paramString(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- objects are handled above
  return String(value)
}

/** Axios' param rules: null/undefined dropped, arrays as repeated `name[]`, values as strings. */
function paramPairs(params: HttpRequestOptions['params']): [string, string][] {
  const pairs: [string, string][] = []
  for (const [name, value] of Object.entries(params ?? {}) as [string, unknown][]) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      const key = name.endsWith('[]') ? name : `${name}[]`
      for (const item of value as unknown[]) {
        if (item !== undefined && item !== null) pairs.push([key, paramString(item)])
      }
      continue
    }
    pairs.push([name, paramString(value)])
  }
  return pairs
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

async function buildRequest(
  method: ApiMethod,
  url: string,
  body: unknown,
  options: HttpRequestOptions,
  locale: string,
): Promise<{ request: ApiRequest; key: string }> {
  const { path, query } = splitUrl(url)
  const request: ApiRequest = { method, path: `${API_BASE}${path}` }
  const allQuery = [...query, ...paramPairs(options.params)]
  if (allQuery.length > 0) request.query = allQuery

  const headers = new Headers()
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (!RUNTIME_HEADERS.includes(name.toLowerCase())) headers.set(name, value)
  }
  if (body instanceof FormData) {
    // The browser's own multipart encoding, boundary included.
    const encoded = new Response(body)
    headers.set('Content-Type', encoded.headers.get('content-type') ?? 'multipart/form-data')
    request.body = { kind: 'binary', base64: toBase64(new Uint8Array(await encoded.arrayBuffer())) }
  } else if (body !== undefined) {
    request.body = { kind: 'json', value: body }
  }
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
  if (locale) headers.set('Accept-Language', locale)
  if (headers.pairs().length > 0) request.headers = headers.pairs()
  return { request, key: path }
}

/** JSON of an answer body (a text body is parsed when it is JSON). */
function jsonOf(response: ApiResponse): unknown {
  const body = response.body
  if (body?.kind === 'json') return body.value
  if (body?.kind === 'text') {
    try {
      return JSON.parse(body.value) as unknown
    } catch {
      return undefined
    }
  }
  return undefined
}

function offlineMetaOf(response: ApiResponse): OfflineMeta | undefined {
  const value = jsonOf(response)
  const meta = isRecord(value) ? value.meta : undefined
  const offline = isRecord(meta) ? meta.offline : undefined
  return isRecord(offline) ? (offline as unknown as OfflineMeta) : undefined
}

function valueOf(response: ApiResponse): unknown {
  const body = response.body
  if (!body) return undefined
  if (body.kind === 'json' || body.kind === 'text') return body.value
  return new Blob([fromBase64(body.base64)], { type: header(response, 'content-type') ?? '' })
}

function blobOf(response: ApiResponse): Blob {
  const type = header(response, 'content-type') ?? ''
  const body = response.body
  if (!body) return new Blob([], { type })
  if (body.kind === 'binary') return new Blob([fromBase64(body.base64)], { type })
  if (body.kind === 'text') return new Blob([body.value], { type })
  return new Blob([JSON.stringify(body.value)], { type })
}

function canceled(): ApiError {
  // Same code and message as an axios cancel through the web client.
  return new ApiError(0, 'NETWORK_ERROR', 'canceled')
}

function stale(): ApiError {
  return new ApiError(0, STALE_REQUEST, 'Company or session changed; answer dropped.')
}

/** `promise`, or a cancel as soon as `signal` aborts (the shell request itself goes on). */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(canceled())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (reason: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(toCommandError(reason))
      },
    )
  })
}

export function createDesktopHttp(options: DesktopHttpOptions): HttpClient {
  const { invoke, deps, network, offlineMeta } = options

  async function send(
    method: ApiMethod,
    url: string,
    body: unknown,
    o: HttpRequestOptions = {},
  ): Promise<ApiResponse> {
    assertApiPath(url)
    if (o.signal?.aborted) throw canceled()
    // The context of the send; an answer for another one is not used.
    const company = deps.getCompanyId()
    const generation = deps.getSessionGeneration()
    const isStale = () =>
      deps.getCompanyId() !== company || deps.getSessionGeneration() !== generation
    const { request, key } = await buildRequest(method, url, body, o, deps.getLocale())

    let response: ApiResponse
    try {
      response = await abortable(apiRequest(invoke, request), o.signal)
    } catch (reason) {
      if (reason instanceof ApiError) throw reason
      const failure = toCommandError(reason)
      if (failure.code === 'NETWORK_ERROR') network?.failed()
      if (isStale()) throw stale()
      const error = commandToApiError(failure)
      if (!o.skipAuthHandling) {
        const auth = classifyAuthFailure(error.status, error.code)
        if (auth) deps.onAuthFailure(auth)
      }
      throw error
    }

    if (response.source === 'network') network?.answered()
    if (isStale()) throw stale()
    if (response.source === 'local') {
      const meta = offlineMetaOf(response)
      if (meta) offlineMeta?.record(key, meta)
    } else {
      offlineMeta?.record(key, undefined)
    }

    if (response.status >= 200 && response.status < 300) return response
    const error =
      apiErrorFromEnvelope(response.status, jsonOf(response)) ??
      new ApiError(response.status, 'HTTP_ERROR', `Request failed with status code ${response.status}`)
    if (!o.skipAuthHandling) {
      const auth = classifyAuthFailure(error.status, error.code)
      if (auth) deps.onAuthFailure(auth)
    }
    throw error
  }

  const value = async <T>(method: ApiMethod, url: string, body: unknown, o?: HttpRequestOptions) =>
    valueOf(await send(method, url, body, o)) as T

  return {
    get: (url, o) => value('GET', url, undefined, o),
    post: (url, body, o) => value('POST', url, body, o),
    put: (url, body, o) => value('PUT', url, body, o),
    patch: (url, body, o) => value('PATCH', url, body, o),
    delete: (url, o) => value('DELETE', url, o?.body, o),
    download: async (url, o): Promise<DownloadResult> => {
      const response = await send('GET', url, undefined, o)
      const disposition = header(response, 'content-disposition')
      return {
        blob: blobOf(response),
        filename: disposition === undefined ? null : filenameFromDisposition(disposition),
      }
    },
    prepareSession: () => Promise.resolve(),
  }
}
