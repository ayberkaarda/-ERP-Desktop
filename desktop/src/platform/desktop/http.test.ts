import { describe, expect, it, vi } from 'vitest'

import type { ApiRequest, ApiResponse } from '../../bridge/api'
import { createFakeBridge, deferred, fail, flush } from '../../test/fakeBridge'
import { createDesktopHttp } from './http'
import { createOfflineMetaStore } from './offlineMeta'
import { ApiError, STALE_REQUEST, type AuthFailure, type PlatformDeps } from './u1-shim'

function ok(value: unknown, extra: Partial<ApiResponse> = {}): ApiResponse {
  return {
    status: 200,
    headers: [['content-type', 'application/json']],
    body: { kind: 'json', value },
    source: 'network',
    ...extra,
  }
}

function envelope(status: number, errors: Record<string, unknown>, source: 'network' | 'local' = 'network'): ApiResponse {
  return { status, headers: [['content-type', 'application/json']], body: { kind: 'json', value: { errors } }, source }
}

function setup(answer: (req: ApiRequest) => unknown = () => ok({ data: [] }), overrides: Partial<PlatformDeps> = {}) {
  const failures: AuthFailure[] = []
  const context = { company: 'c1' as string | null, generation: 1, locale: 'tr' }
  const deps: PlatformDeps = {
    getCompanyId: () => context.company,
    getLocale: () => context.locale,
    getSessionGeneration: () => context.generation,
    onAuthFailure: (f) => failures.push(f),
    ...overrides,
  }
  const bridge = createFakeBridge({
    commands: { api_request: (args) => answer((args as { req: ApiRequest }).req) },
  })
  const network = { failed: vi.fn(), answered: vi.fn() }
  const offlineMeta = createOfflineMetaStore()
  const http = createDesktopHttp({ invoke: bridge.invoke, deps, network, offlineMeta })
  const sent = () => bridge.callsOf('api_request').map((c) => (c.args as { req: ApiRequest }).req)
  return { http, bridge, failures, context, network, offlineMeta, sent }
}

describe('desktop http: request mapping', () => {
  it.each([
    ['GET /parties', (h: ReturnType<typeof setup>['http']) => h.get('/parties'), { method: 'GET', path: '/api/v1/parties' }],
    ['path without a slash', (h: ReturnType<typeof setup>['http']) => h.get('auth/me'), { method: 'GET', path: '/api/v1/auth/me' }],
    [
      'query in the url, then params; boolean as axios writes it, undefined/null dropped, arrays repeat name[]',
      (h: ReturnType<typeof setup>['http']) =>
        h.get('/parties?sort=name#frag', {
          params: {
            page: 2,
            active: true,
            archived: false,
            skip: undefined,
            ...({ none: null, 'ids[]': ['a', 'b'], tags: ['x', null, 'y'], empty: [] } as unknown as Record<string, string>),
            q: '',
          },
        }),
      {
        method: 'GET',
        path: '/api/v1/parties',
        query: [
          ['sort', 'name'],
          ['page', '2'],
          ['active', 'true'],
          ['archived', 'false'],
          ['ids[]', 'a'],
          ['ids[]', 'b'],
          ['tags[]', 'x'],
          ['tags[]', 'y'],
          ['q', ''],
        ],
      },
    ],
    [
      'POST JSON body with Idempotency-Key',
      (h: ReturnType<typeof setup>['http']) => h.post('/sales/quotes', { name: 'A' }, { idempotencyKey: 'k-1' }),
      {
        method: 'POST',
        path: '/api/v1/sales/quotes',
        headers: [['Idempotency-Key', 'k-1']],
        body: { kind: 'json', value: { name: 'A' } },
      },
    ],
    [
      'PUT and PATCH carry their body',
      (h: ReturnType<typeof setup>['http']) => h.patch('/parties/1', { v: 2 }),
      { method: 'PATCH', path: '/api/v1/parties/1', body: { kind: 'json', value: { v: 2 } } },
    ],
    [
      'POST without body sends none',
      (h: ReturnType<typeof setup>['http']) => h.post('/sales/quotes/1/approve'),
      { method: 'POST', path: '/api/v1/sales/quotes/1/approve' },
    ],
    [
      'DELETE with a body',
      (h: ReturnType<typeof setup>['http']) => h.delete('/parties/1', { body: { reason: 'dup' } }),
      { method: 'DELETE', path: '/api/v1/parties/1', body: { kind: 'json', value: { reason: 'dup' } } },
    ],
    [
      'caller headers pass, the runtime locale wins over a caller Accept-Language',
      (h: ReturnType<typeof setup>['http']) =>
        h.put('/x', null, { headers: { 'If-None-Match': 'e1', 'accept-language': 'de' } }),
      {
        method: 'PUT',
        path: '/api/v1/x',
        headers: [['If-None-Match', 'e1']],
        body: { kind: 'json', value: null },
      },
    ],
  ])('%s', async (_name, run, expected) => {
    const s = setup()
    await run(s.http)
    const req = s.sent()[0]
    const { headers = [], ...rest } = expected as ApiRequest
    expect({ ...req, headers: undefined }).toEqual({ ...rest, headers: undefined })
    expect(req?.headers).toEqual([...headers, ['Accept-Language', 'tr']])
  })

  it('sends no Accept-Language when the locale is empty', async () => {
    const s = setup()
    s.context.locale = ''
    await s.http.get('/x')
    expect(s.sent()[0]).toEqual({ method: 'GET', path: '/api/v1/x' })
  })

  it('never sends a company header: the company comes from the profile', async () => {
    const s = setup()
    await s.http.get('/x', { headers: { 'X-Company-Id': 'evil' } })
    expect(s.sent()[0]?.headers).toEqual([['Accept-Language', 'tr']])
  })

  it('turns FormData into the exact multipart bytes and boundary', async () => {
    const s = setup()
    const form = new FormData()
    form.append('kind', 'invoice')
    form.append('file', new Blob([new Uint8Array([0, 1, 2, 255])], { type: 'application/pdf' }), 'a.pdf')
    await s.http.post('/attachments', form, { headers: { 'Content-Type': 'application/json' } })
    const req = s.sent()[0]
    const contentType = req?.headers?.find(([n]) => n.toLowerCase() === 'content-type')?.[1] ?? ''
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
    expect(req?.headers?.filter(([n]) => n.toLowerCase() === 'content-type')).toHaveLength(1)
    expect(req?.body?.kind).toBe('binary')
    const sentBytes = Uint8Array.from(atob((req?.body as { base64: string }).base64), (ch) => ch.charCodeAt(0))
    // The same bytes come back as the same form when parsed with the sent boundary.
    const parsed = await new Response(sentBytes, { headers: { 'content-type': contentType } }).formData()
    expect(parsed.get('kind')).toBe('invoice')
    const file = parsed.get('file') as File
    expect(file.name).toBe('a.pdf')
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([0, 1, 2, 255])
    const reference = new Uint8Array(await new Response(form).arrayBuffer())
    expect(sentBytes.length).toBe(reference.length)
  })

  it('refuses an absolute url before sending anything', async () => {
    const s = setup()
    await expect(s.http.get('https://evil.test/x')).rejects.toMatchObject({ code: 'INVALID_URL', status: 0 })
    await expect(s.http.get('//evil.test/x')).rejects.toBeInstanceOf(ApiError)
    expect(s.sent()).toEqual([])
  })

  it('has no streaming and a no-op session priming', async () => {
    const s = setup()
    expect('streamPost' in s.http).toBe(false)
    await expect(s.http.prepareSession()).resolves.toBeUndefined()
    expect(s.bridge.calls).toEqual([])
  })
})

describe('desktop http: answers', () => {
  it('returns the JSON body of a 2xx answer as is', async () => {
    const body = { data: [{ id: '1' }], meta: { pagination: { total: 1 } } }
    const s = setup(() => ok(body))
    await expect(s.http.get('/parties')).resolves.toEqual(body)
  })

  it('returns undefined for an empty 204 and the text of a text answer', async () => {
    const s = setup(() => ({ status: 204, headers: [], body: null, source: 'network' }))
    await expect(s.http.delete('/x')).resolves.toBeUndefined()
    const t = setup(() => ({ status: 200, headers: [], body: { kind: 'text', value: 'a;b' }, source: 'network' }))
    await expect(t.http.get('/x')).resolves.toBe('a;b')
  })

  it('downloads a binary answer as a Blob with a safe file name', async () => {
    const s = setup(() => ({
      status: 200,
      headers: [
        ['content-type', 'application/pdf'],
        ['content-disposition', 'attachment; filename="../x.pdf"; filename*=UTF-8\'\'fatura%20%C3%A7.pdf'],
      ],
      body: { kind: 'binary', base64: 'JVBERg==' },
      source: 'network',
    }))
    const result = await s.http.download('/sales/invoices/1/pdf', { params: { format: 'pdf' } })
    expect(s.sent()[0]).toMatchObject({ method: 'GET', query: [['format', 'pdf']] })
    expect(result.filename).toBe('fatura ç.pdf')
    expect(result.blob.type).toBe('application/pdf')
    expect(Array.from(new Uint8Array(await result.blob.arrayBuffer()))).toEqual([0x25, 0x50, 0x44, 0x46])
  })

  it('downloads text and JSON answers too, without a file name when none is given', async () => {
    const csv = setup(() => ({ status: 200, headers: [['content-type', 'text/csv']], body: { kind: 'text', value: 'a;ç' }, source: 'network' }))
    const r1 = await csv.http.download('/r')
    expect(await r1.blob.text()).toBe('a;ç')
    expect(r1.filename).toBeNull()
    const js = setup(() => ok({ a: 1 }))
    expect(await (await js.http.download('/r')).blob.text()).toBe('{"a":1}')
  })

  it('reads the error envelope of a failed download', async () => {
    const s = setup(() => envelope(422, { message: 'bad', code: 'VALIDATION_FAILED' }))
    await expect(s.http.download('/r')).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED' })
  })
})

describe('desktop http: server error table', () => {
  it.each([
    [envelope(422, { message: 'Geçersiz', code: 'VALIDATION_FAILED', fields: { name: ['Zorunlu'] }, details: { a: 1 } }), { status: 422, code: 'VALIDATION_FAILED', message: 'Geçersiz', fields: { name: ['Zorunlu'] }, details: { a: 1 } }],
    [envelope(409, { message: 'v', code: 'VERSION_CONFLICT' }), { status: 409, code: 'VERSION_CONFLICT', fields: {}, details: {} }],
    [envelope(503, { message: 'off', code: 'OFFLINE_UNAVAILABLE' }, 'local'), { status: 503, code: 'OFFLINE_UNAVAILABLE' }],
    [envelope(422, { message: 'closed', code: 'SYNC_OFFLINE_WRITE_NOT_ALLOWED' }, 'local'), { status: 422, code: 'SYNC_OFFLINE_WRITE_NOT_ALLOWED' }],
    [{ status: 502, headers: [], body: { kind: 'text', value: '<html>bad gateway</html>' }, source: 'network' }, { status: 502, code: 'HTTP_ERROR' }],
    [{ status: 500, headers: [], body: { kind: 'text', value: '{"errors":{"message":"m","code":"SERVER_ERROR"}}' }, source: 'network' }, { status: 500, code: 'SERVER_ERROR' }],
    [{ status: 500, headers: [], body: null, source: 'network' }, { status: 500, code: 'HTTP_ERROR' }],
  ])('answer %# becomes an ApiError', async (answer, expected) => {
    const s = setup(() => answer)
    const error = await s.http.get('/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject(expected)
  })
})

describe('desktop http: command error table', () => {
  it.each([
    ['UNAUTHENTICATED', 401, 'unauthenticated'],
    ['NO_ACTIVE_PROFILE', 401, 'unauthenticated'],
    ['USER_DEACTIVATED', 403, 'deactivated'],
    ['PASSWORD_CHANGE_REQUIRED', 403, 'passwordChangeRequired'],
    ['PAYLOAD_TOO_LARGE', 413, null],
    ['NETWORK_ERROR', 0, null],
    ['TASK_FAILED', 0, null],
    ['INVALID_REQUEST', 0, null],
    ['ENGINE_UNAVAILABLE', 0, null],
    ['SOMETHING_NEW', 0, null],
  ] as const)('%s -> status %i, auth failure %s', async (code, status, failure) => {
    const s = setup(() => fail(code, `msg ${code}`))
    const error = await s.http.get('/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status, code, message: `msg ${code}` })
    expect(s.failures).toEqual(failure ? [failure] : [])
  })

  it('keeps retry_after in the details', async () => {
    const s = setup(() => fail('NETWORK_ERROR', 'slow', 30))
    await expect(s.http.get('/x')).rejects.toMatchObject({ details: { retry_after: 30 } })
  })

  it('a rejection without a code is UNKNOWN', async () => {
    const s = setup(() => {
      throw new Error('boom')
    })
    await expect(s.http.get('/x')).rejects.toMatchObject({ status: 0, code: 'UNKNOWN', message: 'boom' })
  })
})

describe('desktop http: session failures', () => {
  it.each([
    [envelope(401, { message: 'x', code: 'UNAUTHENTICATED' }), 'unauthenticated'],
    [envelope(403, { message: 'x', code: 'USER_DEACTIVATED' }), 'deactivated'],
    [envelope(403, { message: 'x', code: 'PASSWORD_CHANGE_REQUIRED' }), 'passwordChangeRequired'],
  ] as const)('server answer %# reports %s once', async (answer, failure) => {
    const s = setup(() => answer)
    await expect(s.http.get('/x')).rejects.toBeInstanceOf(ApiError)
    expect(s.failures).toEqual([failure])
  })

  it('a plain 403 is not a session failure', async () => {
    const s = setup(() => envelope(403, { message: 'x', code: 'FORBIDDEN' }))
    await expect(s.http.get('/x')).rejects.toMatchObject({ status: 403 })
    expect(s.failures).toEqual([])
  })

  it('skipAuthHandling leaves the failure to the caller', async () => {
    const s = setup(() => envelope(401, { message: 'x', code: 'UNAUTHENTICATED' }))
    await expect(s.http.get('/auth/me', { skipAuthHandling: true })).rejects.toMatchObject({ status: 401 })
    const c = setup(() => fail('UNAUTHENTICATED'))
    await expect(c.http.get('/auth/me', { skipAuthHandling: true })).rejects.toMatchObject({ status: 401 })
    expect([...s.failures, ...c.failures]).toEqual([])
  })

  it.each([
    ['session generation', (ctx: { generation: number; company: string | null }) => { ctx.generation = 2 }],
    ['company', (ctx: { generation: number; company: string | null }) => { ctx.company = 'c2' }],
  ])('a 401 that returns after the %s changed is stale and reports nothing', async (_n, change) => {
    const answer = deferred<ApiResponse>()
    const s = setup(() => answer.promise)
    const pending = s.http.get('/x').catch((e: unknown) => e)
    await flush()
    change(s.context)
    answer.resolve(envelope(401, { message: 'x', code: 'UNAUTHENTICATED' }))
    const error = await pending
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: STALE_REQUEST, status: 0 })
    expect(s.failures).toEqual([])
  })

  it('a command failure of an older session is stale too', async () => {
    const answer = deferred<ApiResponse>()
    const s = setup(() => answer.promise)
    const pending = s.http.get('/x').catch((e: unknown) => e)
    await flush()
    s.context.generation = 5
    answer.reject({ code: 'USER_DEACTIVATED', message: 'x' })
    expect(await pending).toMatchObject({ code: STALE_REQUEST })
    expect(s.failures).toEqual([])
  })

  it('a success that returns after the session changed is stale as well', async () => {
    const answer = deferred<ApiResponse>()
    const s = setup(() => answer.promise)
    const pending = s.http.get('/x').catch((e: unknown) => e)
    await flush()
    s.context.company = null
    answer.resolve(ok({ data: 1 }))
    expect(await pending).toMatchObject({ code: STALE_REQUEST })
  })
})

describe('desktop http: cancel', () => {
  it('an aborted signal sends nothing', async () => {
    const s = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(s.http.get('/x', { signal: controller.signal })).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR', message: 'canceled' })
    expect(s.sent()).toEqual([])
  })

  it('aborting in flight drops the late answer without side effects', async () => {
    const answer = deferred<ApiResponse>()
    const s = setup(() => answer.promise)
    const controller = new AbortController()
    const pending = s.http.get('/x', { signal: controller.signal }).catch((e: unknown) => e)
    await flush()
    controller.abort()
    expect(await pending).toMatchObject({ code: 'NETWORK_ERROR', message: 'canceled' })
    answer.resolve(envelope(401, { message: 'x', code: 'UNAUTHENTICATED' }))
    await flush()
    expect(s.failures).toEqual([])
    expect(s.network.answered).not.toHaveBeenCalled()
  })
})

describe('desktop http: network and offline meta', () => {
  it('reports a NETWORK_ERROR and a network answer, but not a local one', async () => {
    let answer: () => unknown = () => fail('NETWORK_ERROR')
    const s = setup(() => answer())
    await expect(s.http.get('/x')).rejects.toBeInstanceOf(ApiError)
    expect(s.network.failed).toHaveBeenCalledTimes(1)
    answer = () => ok({ data: [] }, { source: 'local' })
    await s.http.get('/x')
    expect(s.network.answered).not.toHaveBeenCalled()
    answer = () => envelope(500, { message: 'x', code: 'SERVER_ERROR' })
    await expect(s.http.get('/x')).rejects.toBeInstanceOf(ApiError)
    expect(s.network.answered).toHaveBeenCalledTimes(1)
    expect(s.network.failed).toHaveBeenCalledTimes(1)
  })

  it('other command errors say nothing about the network', async () => {
    const s = setup(() => fail('INVALID_REQUEST'))
    await expect(s.http.get('/x')).rejects.toBeInstanceOf(ApiError)
    expect(s.network.failed).not.toHaveBeenCalled()
    expect(s.network.answered).not.toHaveBeenCalled()
  })

  it('keeps meta.offline in the body and records it per path; a network answer clears it', async () => {
    const offline = { as_of: '2026-11-01T10:00:00Z', partial: true, stale: true, pending: 2, unsupported_filters: ['filter[city]'] }
    const body = { data: [], meta: { offline } }
    let answer: ApiResponse = ok(body, { source: 'local' })
    const s = setup(() => answer)
    await expect(s.http.get('/parties?page=1')).resolves.toEqual(body)
    expect(s.offlineMeta.get('/parties')).toEqual(offline)
    answer = ok({ data: [] })
    await s.http.get('/parties')
    expect(s.offlineMeta.get('/parties')).toBeUndefined()
  })

  it('records the offline meta of a local refusal too', async () => {
    const s = setup(() => ({
      status: 503,
      headers: [],
      body: { kind: 'json', value: { errors: { message: 'm', code: 'OFFLINE_UNAVAILABLE' }, meta: { offline: { partial: false, stale: false, unsupported_filters: ['q'] } } } },
      source: 'local',
    }))
    await expect(s.http.get('/stock/balances')).rejects.toMatchObject({ code: 'OFFLINE_UNAVAILABLE' })
    expect(s.offlineMeta.get('/stock/balances')).toMatchObject({ unsupported_filters: ['q'] })
  })

  it('a local answer without offline meta records nothing, and a stale one is not recorded', async () => {
    const answer = deferred<ApiResponse>()
    const s = setup(() => answer.promise)
    const pending = s.http.get('/a').catch(() => undefined)
    await flush()
    s.context.generation = 9
    answer.resolve(ok({ data: [], meta: { offline: { partial: false, stale: true } } }, { source: 'local' }))
    await pending
    expect(s.offlineMeta.get('/a')).toBeUndefined()
    const t = setup(() => ok({ data: [] }, { source: 'local' }))
    await t.http.get('/b')
    expect(t.offlineMeta.get('/b')).toBeUndefined()
  })
})
