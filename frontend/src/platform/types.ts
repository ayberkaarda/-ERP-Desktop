// Contract every runtime (web today, desktop later) implements. Features depend on this only.

export interface HttpRequestOptions {
  params?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Sent as Idempotency-Key; required by the API for document-creating POSTs. */
  idempotencyKey?: string
  /** JSON body for DELETE requests that need one. */
  body?: unknown
  /** Leaves 401/403 session failures to the caller (session probe, login steps). */
  skipAuthHandling?: boolean
}

export interface HttpClient {
  get<T>(url: string, options?: HttpRequestOptions): Promise<T>
  post<T>(url: string, body?: unknown, options?: HttpRequestOptions): Promise<T>
  put<T>(url: string, body?: unknown, options?: HttpRequestOptions): Promise<T>
  patch<T>(url: string, body?: unknown, options?: HttpRequestOptions): Promise<T>
  delete<T>(url: string, options?: HttpRequestOptions): Promise<T>
  /** Primes the session (Sanctum CSRF cookie on web) before the first unsafe request. */
  prepareSession(): Promise<void>
}

/** Session failures the HTTP layer reports upward; the auth feature decides what to do. */
export type AuthFailure = 'unauthenticated' | 'deactivated' | 'passwordChangeRequired'

export type SubscriptionStatus = 'subscribed' | 'error'

export type RealtimeState = 'disabled' | 'idle' | 'connecting' | 'connected' | 'unavailable'

export interface Realtime {
  /** Opens the socket on first call; only call after login. */
  connect(): void
  disconnect(): void
  /** Listens on a private channel; the returned function stops listening. */
  listenPrivate(
    channel: string,
    event: string,
    handler: (payload: unknown) => void,
    /** Reports whether the channel subscription (incl. authorization) succeeded. */
    onStatus?: (status: SubscriptionStatus) => void,
  ): () => void
  state(): RealtimeState
  subscribe(listener: (state: RealtimeState) => void): () => void
}

export interface Connectivity {
  isOnline(): boolean
  subscribe(listener: (online: boolean) => void): () => void
}

export interface NotifyOptions {
  description?: string
}

export interface Notify {
  success(message: string, options?: NotifyOptions): void
  info(message: string, options?: NotifyOptions): void
  warning(message: string, options?: NotifyOptions): void
  error(message: string, options?: NotifyOptions): void
}

export interface Platform {
  kind: 'web' | 'desktop'
  http: HttpClient
  connectivity: Connectivity
  notify: Notify
  realtime: Realtime
}

/** API envelopes, see CONTRACT: {data, meta} and {errors:{message, code, fields?}}. */
export interface ApiSuccess<T, M = Record<string, unknown>> {
  data: T
  meta?: M
}

export interface ApiErrorBody {
  errors: {
    message: string
    code: string
    fields?: Record<string, string[]>
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string[]>

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string[]> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}
