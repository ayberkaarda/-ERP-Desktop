import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { createWebHttp } from './http'

function client(options: Parameters<typeof createWebHttp>[0] = {}) {
  const value = createWebHttp(options)
  if (!value.streamPost) throw new Error('Missing streaming adapter')
  return value.streamPost.bind(value)
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('posts same-origin SSE with company, CSRF, locale and request headers', async () => {
  const fetchCall = vi.spyOn(globalThis, 'fetch')
  document.cookie = 'XSRF-TOKEN=csrf%2Btoken; path=/'
  let seen: Request | undefined
  server.use(
    http.post('*/api/v1/assistant/conversations/c1/messages', ({ request }) => {
      seen = request
      return new HttpResponse('event: done\ndata: {}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }),
  )
  const stream = await client({ getCompanyId: () => 'company-1', getLocale: () => 'tr' })(
    '/assistant/conversations/c1/messages',
    { message: 'Hello' },
    { idempotencyKey: 'logical-id' },
  )
  expect(seen?.headers.get('X-Company-Id')).toBe('company-1')
  expect(seen?.headers.get('X-XSRF-TOKEN')).toBe('csrf+token')
  expect(seen?.headers.get('Accept-Language')).toBe('tr')
  expect(seen?.headers.get('Idempotency-Key')).toBe('logical-id')
  expect(seen?.credentials).toBe('same-origin')
  expect(fetchCall).toHaveBeenCalledWith(
    '/api/v1/assistant/conversations/c1/messages',
    expect.objectContaining({ redirect: 'error' }),
  )
  expect(await new Response(stream).text()).toContain('event: done')
})
it('recovers CSRF once and reuses the same body without crossing company/session', async () => {
  let calls = 0
  const received: unknown[] = []
  server.use(
    http.get('*/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
    http.post('*/api/v1/assistant/send', async ({ request }) => {
      received.push(await request.json())
      calls++
      return calls === 1
        ? HttpResponse.json({ errors: { code: 'CSRF', message: 'Expired' } }, { status: 419 })
        : new HttpResponse('event: done\ndata: {}\n\n', {
            headers: { 'Content-Type': 'text/event-stream' },
          })
    }),
  )
  const body = { message: 'Question', request_id: 'same-request' }
  const stream = await client({ getCompanyId: () => 'c1', getSessionGeneration: () => 1 })(
    '/assistant/send',
    body,
  )
  await stream.cancel()
  expect(calls).toBe(2)
  expect(received).toEqual([body, body])
})
it('refuses CSRF replay when company changes during cookie refresh', async () => {
  let company = 'c1'
  let calls = 0
  server.use(
    http.get('*/sanctum/csrf-cookie', () => {
      company = 'c2'
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('*/api/v1/assistant/send', () => {
      calls++
      return new HttpResponse(null, { status: 419 })
    }),
  )
  await expect(
    client({ getCompanyId: () => company })('/assistant/send', {}),
  ).rejects.toMatchObject({ code: 'REQUEST_STALE' })
  expect(calls).toBe(1)
})
it('reports expired session instead of parsing an error response as SSE', async () => {
  const failure = vi.fn()
  server.use(
    http.post('*/api/v1/assistant/send', () =>
      HttpResponse.json(
        { errors: { code: 'UNAUTHENTICATED', message: 'Sign in' } },
        { status: 401 },
      ),
    ),
  )
  await expect(client({ onAuthFailure: failure })('/assistant/send', {})).rejects.toMatchObject({
    status: 401,
    code: 'UNAUTHENTICATED',
  })
  expect(failure).toHaveBeenCalledWith('unauthenticated')
})
it('forwards abort signals and rejects HTML or external targets', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    client()('/assistant/send', {}, { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' })
  await expect(client()('https://evil.example', {})).rejects.toMatchObject({ code: 'INVALID_URL' })
  await expect(
    client({ baseURL: 'https://evil.example/api' })('/assistant/send', {}),
  ).rejects.toMatchObject({ code: 'INVALID_URL' })
  server.use(
    http.post(
      '*/api/v1/assistant/send',
      () => new HttpResponse('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }),
    ),
  )
  await expect(client()('/assistant/send', {})).rejects.toMatchObject({ code: 'INVALID_STREAM' })
})
