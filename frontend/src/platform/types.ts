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

export interface DownloadResult {
  blob: Blob
  /** From Content-Disposition, reduced to a bare file name; null when absent or unusable. */
  filename: string | null
}

export interface HttpClient {
  /** POST with an SSE body. Optional for runtimes without streaming support. */
  streamPost?(
    url: string,
    body: unknown,
    options?: HttpRequestOptions,
  ): Promise<ReadableStream<Uint8Array>>
  get<T>(url: string, options?: HttpRequestOptions): Promise<T>
  post<T>(url: string, body?: unknown, options?: HttpRequestOptions): Promise<T>
  put<T>(url: string, body?: unknown, options?: HttpRequestOptions): Promise<T>
  patch<T>(url: string, body?: unknown, options?: HttpRequestOptions): Promise<T>
  delete<T>(url: string, options?: HttpRequestOptions): Promise<T>
  /** GET returning the raw body as a Blob plus the server-suggested file name (exports). */
  download(url: string, options?: HttpRequestOptions): Promise<DownloadResult>
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

export interface Platform {
  kind: 'web' | 'desktop'
  http: HttpClient
  connectivity: Connectivity
  notify: Notify
  realtime: Realtime
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
  /** Structured context of the error (`errors.details`), e.g. a credit limit breakdown. */
  readonly details: Record<string, unknown>

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string[]> = {},
    details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
    this.details = details
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}
