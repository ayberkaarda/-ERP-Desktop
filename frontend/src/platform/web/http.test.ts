import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { ApiError } from '../types'
import {
  createWebHttp,
  filenameFromDisposition,
  isStaleRequest,
  STALE_REQUEST,
  withIdempotency,
} from './http'

const client = createWebHttp({ getCompanyId: () => 'company-1' })

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('expected rejection')
}

describe('web http adapter', () => {
  it.each(['https://evil.test/steal', '//evil.test/steal', '\\\\evil.test', 'javascript:alert(1)'])(
    'refuses non-API target %s before any request',
    async (url) => {
      let hit = false
      server.use(
        http.all('*', () => {
          hit = true
          return HttpResponse.json({})
        }),
      )
      const error = await rejection(client.get(url))
      expect(error.code).toBe('INVALID_URL')
      expect(hit).toBe(false)
    },
  )

  it('sends API paths under the base with the company header', async () => {
    let companyHeader: string | null = null
    server.use(
      http.get('*/api/v1/things', ({ request }) => {
        companyHeader = request.headers.get('X-Company-Id')
        return HttpResponse.json({ data: [] })
      }),
    )
    await expect(client.get('/things')).resolves.toEqual({ data: [] })
    expect(companyHeader).toBe('company-1')
  })

  it.each([
    [{ errors: null }, 'HTTP_ERROR'],
    [{ errors: 'boom' }, 'HTTP_ERROR'],
    [{ errors: { message: 'Bozuk', code: 42 } }, 'HTTP_ERROR'],
    ['<html>gateway</html>', 'HTTP_ERROR'],
  ])('survives malformed error body %j', async (body, code) => {
    server.use(http.get('*/api/v1/broken', () => HttpResponse.json(body, { status: 500 })))
    const error = await rejection(client.get('/broken'))
    expect(error.status).toBe(500)
    expect(error.code).toBe(code)
  })

  it('maps the error envelope with fields', async () => {
    server.use(
      http.post('*/api/v1/items', () =>
        HttpResponse.json(
          {
            errors: {
              message: 'Geçersiz',
              code: 'VALIDATION_FAILED',
              fields: { name: ['Zorunlu'], bad: 3 },
            },
          },
          { status: 422 },
        ),
      ),
    )
    const error = await rejection(client.post('/items', {}))
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_FAILED', message: 'Geçersiz' })
    expect(error.fields).toEqual({ name: ['Zorunlu'] })
    expect(error.details).toEqual({})
  })

  it('keeps errors.details and ignores a details value that is not an object', async () => {
    const details = { mode: 'block', limit: '1000.00', currency: 'TRY', exceeded: true }
    server.use(
      http.post('*/api/v1/orders', () =>
        HttpResponse.json(
          { errors: { message: 'Limit', code: 'sales.credit_limit_exceeded', details } },
          { status: 422 },
        ),
      ),
      http.post('*/api/v1/other', () =>
        HttpResponse.json(
          { errors: { message: 'X', code: 'X', details: ['not', 'an', 'object'] } },
          { status: 422 },
        ),
      ),
    )
    expect((await rejection(client.post('/orders', {}))).details).toEqual(details)
    expect((await rejection(client.post('/other', {}))).details).toEqual({})
  })
})

describe('session handling', () => {
  it('refreshes the CSRF cookie once on 419 and replays the request with its headers', async () => {
    let csrf = 0
    const seen: (string | null)[] = []
    let attempts = 0
    server.use(
      http.get('*/sanctum/csrf-cookie', () => {
        csrf += 1
        return new HttpResponse(null, { status: 204 })
      }),
      http.post('*/api/v1/orders', ({ request }) => {
        attempts += 1
        seen.push(request.headers.get('Idempotency-Key'))
        if (attempts === 1) return HttpResponse.json({}, { status: 419 })
        return HttpResponse.json({ data: { ok: true } })
      }),
    )
    const result = await client.post('/orders', { a: 1 }, withIdempotency({}, 'key-1'))
    expect(result).toEqual({ data: { ok: true } })
    expect(csrf).toBe(1)
    expect(seen).toEqual(['key-1', 'key-1'])
  })

  it('gives up after one CSRF retry', async () => {
    let attempts = 0
    server.use(
      http.get('*/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      http.post('*/api/v1/orders', () => {
        attempts += 1
        return HttpResponse.json({}, { status: 419 })
      }),
    )
    const error = await rejection(client.post('/orders', {}))
    expect(error.status).toBe(419)
    expect(attempts).toBe(2)
  })

  it.each([
    [401, 'UNAUTHENTICATED', 'unauthenticated'],
    [403, 'USER_DEACTIVATED', 'deactivated'],
    [403, 'PASSWORD_CHANGE_REQUIRED', 'passwordChangeRequired'],
  ])('reports %i %s as %s', async (status, code, failure) => {
    const onAuthFailure = vi.fn()
    const c = createWebHttp({ onAuthFailure })
    server.use(
      http.get('*/api/v1/secret', () =>
        HttpResponse.json({ errors: { message: 'x', code } }, { status }),
      ),
    )
    await rejection(c.get('/secret'))
    expect(onAuthFailure).toHaveBeenCalledWith(failure)
  })

  it('ignores plain 403 and requests that handle auth themselves', async () => {
    const onAuthFailure = vi.fn()
    const c = createWebHttp({ onAuthFailure })
    server.use(
      http.get('*/api/v1/forbidden', () =>
        HttpResponse.json({ errors: { message: 'x', code: 'FORBIDDEN' } }, { status: 403 }),
      ),
      http.get('*/api/v1/me', () =>
        HttpResponse.json({ errors: { message: 'x', code: 'UNAUTHENTICATED' } }, { status: 401 }),
      ),
    )
    await rejection(c.get('/forbidden'))
    await rejection(c.get('/me', { skipAuthHandling: true }))
    expect(onAuthFailure).not.toHaveBeenCalled()
  })

  it('sends a DELETE body and primes the session cookie', async () => {
    let body: unknown = null
    let csrf = 0
    server.use(
      http.get('*/sanctum/csrf-cookie', () => {
        csrf += 1
        return new HttpResponse(null, { status: 204 })
      }),
      http.delete('*/api/v1/thing', async ({ request }) => {
        body = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await client.prepareSession()
    await client.delete('/thing', { body: { password: 'p' } })
    expect(csrf).toBe(1)
    expect(body).toEqual({ password: 'p' })
  })

  it('creates distinct idempotency keys unless one is reused', () => {
    const a = withIdempotency()
    const b = withIdempotency()
    expect(a.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey)
    expect(withIdempotency({ params: { x: 1 } }, 'same')).toEqual({
      params: { x: 1 },
      idempotencyKey: 'same',
    })
  })
})

describe('CSRF replay guards', () => {
  it('does not hang when the CSRF refresh itself answers 419', async () => {
    server.use(
      http.get('*/sanctum/csrf-cookie', () => HttpResponse.json({}, { status: 419 })),
      http.post('*/api/v1/orders', () => HttpResponse.json({}, { status: 419 })),
    )
    const error = await rejection(client.post('/orders', {}))
    expect(error.status).toBe(419)
    await expect(client.prepareSession()).rejects.toMatchObject({ status: 419 })
  })

  it('leaves 419 to requests that handle auth themselves', async () => {
    let csrf = 0
    server.use(
      http.get('*/sanctum/csrf-cookie', () => {
        csrf += 1
        return new HttpResponse(null, { status: 204 })
      }),
      http.post('*/api/v1/auth/login', () => HttpResponse.json({}, { status: 419 })),
    )
    const error = await rejection(client.post('/auth/login', {}, { skipAuthHandling: true }))
    expect(error.status).toBe(419)
    expect(csrf).toBe(0)
  })

  it.each([
    ['company', { company: 'B', generation: 1 }],
    ['session', { company: 'A', generation: 2 }],
  ])('refuses to replay when the %s changed during the refresh', async (_label, after) => {
    const ctx = { company: 'A', generation: 1 }
    const c = createWebHttp({
      getCompanyId: () => ctx.company,
      getSessionGeneration: () => ctx.generation,
    })
    let posts = 0
    server.use(
      http.get('*/sanctum/csrf-cookie', () => {
        Object.assign(ctx, after)
        return new HttpResponse(null, { status: 204 })
      }),
      http.post('*/api/v1/orders', () => {
        posts += 1
        return HttpResponse.json({}, { status: 419 })
      }),
    )
    const error = await rejection(c.post('/orders', {}))
    expect(error.code).toBe(STALE_REQUEST)
    expect(isStaleRequest(error)).toBe(true)
    expect(posts).toBe(1)
  })
})

describe('web http download', () => {
  it('returns the binary body as a Blob with the server file name', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0xff, 0x00, 0xc3])
    let companyHeader: string | null = null
    server.use(
      http.get('*/api/v1/report/export', ({ request }) => {
        companyHeader = request.headers.get('X-Company-Id')
        return new HttpResponse(bytes, {
          headers: { 'Content-Disposition': 'attachment; filename="mizan.xlsx"' },
        })
      }),
    )
    const res = await client.download('/report/export', { params: { format: 'xlsx' } })
    expect([...new Uint8Array(await res.blob.arrayBuffer())]).toEqual([...bytes])
    expect(res.filename).toBe('mizan.xlsx')
    expect(companyHeader).toBe('company-1')
  })

  it('reads the JSON error envelope from a Blob error body', async () => {
    server.use(
      http.get('*/api/v1/report/export', () =>
        HttpResponse.json(
          {
            errors: { message: 'Çok satır', code: 'VALIDATION_FAILED', fields: { filter: ['x'] } },
          },
          { status: 422 },
        ),
      ),
    )
    const error = await rejection(client.download('/report/export'))
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.fields).toEqual({ filter: ['x'] })
  })

  it('refuses absolute URLs', async () => {
    const error = await rejection(client.download('https://evil.test/x'))
    expect(error.code).toBe('INVALID_URL')
  })

  it.each([
    ['attachment; filename="a.csv"', 'a.csv'],
    ['attachment; filename="x.xlsx"; filename*=UTF-8\'\'mizan%20%C3%A7.xlsx', 'mizan ç.xlsx'],
    ['attachment; filename="../../etc/passwd"', 'passwd'],
    ['attachment; filename="..\\..\\boot.ini"', 'boot.ini'],
    ['attachment; filename=".hidden"', 'hidden'],
    ['attachment; filename="a\u0000b<c>.csv"', 'a_b_c_.csv'],
    ["attachment; filename*=UTF-8''%E0%A4%A", null],
    ['attachment', null],
    ['attachment; filename=""', null],
  ])('parses Content-Disposition %j safely', (header, expected) => {
    expect(filenameFromDisposition(header)).toBe(expected)
  })
})
