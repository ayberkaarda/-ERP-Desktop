import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { ApiError } from '../types'
import { createWebHttp } from './http'

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
  })
})
