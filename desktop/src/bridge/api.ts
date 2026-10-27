// `api_request`: the webview's only door to the server. Shapes mirror
// `src-tauri/src/dto/api.rs`; generated types replace them later.

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type ApiBody =
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; value: string }
  | { kind: 'binary'; base64: string }

export interface ApiRequest {
  method: ApiMethod
  /** Full path under `/api/v1/`, without query or fragment. */
  path: string
  query?: [string, string][]
  headers?: [string, string][]
  body?: ApiBody
}

export interface ApiResponse {
  status: number
  /** Lowercase names, allowlisted by the shell. */
  headers: [string, string][]
  body: ApiBody | null
  /** `local`: answered on this device (local data, draft or offline refusal). */
  source: 'network' | 'local'
}

/** The Laravel error envelope `{errors: {message, code, fields?}}`. */
export interface ApiErrorBody {
  message: string
  code: string
  fields?: Record<string, string[]>
}

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export const API_REQUEST = 'api_request'

/** Sends `request` through the shell; rejects with `{code, message, retry_after?}`. */
export function apiRequest(invoke: Invoke, request: ApiRequest): Promise<ApiResponse> {
  return invoke<ApiResponse>(API_REQUEST, { req: request })
}

/** A request with a JSON body (when `json` is given). */
export function jsonRequest(
  method: ApiMethod,
  path: string,
  options: { json?: unknown; query?: Record<string, string | string[]>; headers?: Record<string, string> } = {},
): ApiRequest {
  const request: ApiRequest = { method, path }
  if (options.query) {
    request.query = Object.entries(options.query).flatMap(([name, value]) =>
      Array.isArray(value) ? value.map((v): [string, string] => [name, v]) : [[name, value] as [string, string]],
    )
  }
  if (options.headers) request.headers = Object.entries(options.headers)
  if (options.json !== undefined) request.body = { kind: 'json', value: options.json }
  return request
}

/** First value of header `name` (any case). */
export function header(response: ApiResponse, name: string): string | undefined {
  const wanted = name.toLowerCase()
  return response.headers.find(([n]) => n.toLowerCase() === wanted)?.[1]
}

/** The JSON body, if the answer has one. */
export function json(response: ApiResponse): unknown {
  return response.body?.kind === 'json' ? response.body.value : undefined
}

/** The error envelope of a non-2xx answer, if it carries one. */
export function apiError(response: ApiResponse): ApiErrorBody | undefined {
  if (response.status >= 200 && response.status < 300) return undefined
  const body = json(response) as { errors?: Partial<ApiErrorBody> } | undefined
  const errors = body?.errors
  if (!errors || typeof errors.code !== 'string') return undefined
  const result: ApiErrorBody = {
    code: errors.code,
    message: typeof errors.message === 'string' ? errors.message : '',
  }
  if (errors.fields && typeof errors.fields === 'object') result.fields = errors.fields
  return result
}

/** Bytes of a binary (or text) answer, e.g. for a download. */
export function bytes(response: ApiResponse): Uint8Array | undefined {
  const body = response.body
  if (!body) return undefined
  if (body.kind === 'text') return new TextEncoder().encode(body.value)
  if (body.kind !== 'binary') return undefined
  const raw = atob(body.base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}
