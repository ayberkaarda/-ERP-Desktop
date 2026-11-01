import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { createPlatform } from './runtime'
import type { AuthFailure, PlatformDeps } from './types'

function deps(overrides: Partial<PlatformDeps> = {}): PlatformDeps {
  return {
    getCompanyId: () => 'company-9',
    getLocale: () => 'de',
    getSessionGeneration: () => 1,
    onAuthFailure: () => undefined,
    ...overrides,
  }
}

describe('createPlatform (web runtime)', () => {
  it('builds the web platform without a session override', () => {
    const p = createPlatform(deps())
    expect(p.kind).toBe('web')
    expect(p.session).toBeUndefined()
    expect(typeof p.http.get).toBe('function')
    expect(typeof p.http.streamPost).toBe('function')
    expect(p.realtime.state()).toBe('disabled')
    expect(typeof p.connectivity.isOnline()).toBe('boolean')
  })

  it('configures web realtime from the VITE_REVERB_* build env', () => {
    vi.stubEnv('VITE_REVERB_APP_KEY', 'test-key')
    try {
      expect(createPlatform(deps()).realtime.state()).toBe('idle')
    } finally {
      vi.unstubAllEnvs()
    }
    vi.stubEnv('VITE_REVERB_APP_KEY', '')
    try {
      expect(createPlatform(deps()).realtime.state()).toBe('disabled')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('wires company, locale and auth failures from the given deps', async () => {
    const seen: { company: string | null; locale: string | null } = { company: null, locale: null }
    server.use(
      http.get('*/api/v1/probe', ({ request }) => {
        seen.company = request.headers.get('X-Company-Id')
        seen.locale = request.headers.get('Accept-Language')
        return HttpResponse.json(
          { errors: { message: 'x', code: 'UNAUTHENTICATED' } },
          { status: 401 },
        )
      }),
    )
    const failures: AuthFailure[] = []
    const p = createPlatform(deps({ onAuthFailure: (f) => failures.push(f) }))
    await expect(p.http.get('/probe')).rejects.toMatchObject({ status: 401 })
    expect(seen).toEqual({ company: 'company-9', locale: 'de' })
    expect(failures).toEqual(['unauthenticated'])
  })
})
