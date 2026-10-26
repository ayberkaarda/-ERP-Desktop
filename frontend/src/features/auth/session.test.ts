import { createMemoryRouter } from 'react-router'
import { platform } from '@/platform'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { setupFea, signIn } from '@/test/handlers/feaRender'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { endSession, handleAuthFailure, loadSession, logout, safeRedirect } from './session'

function router(path: string) {
  return createMemoryRouter([{ path: '*', element: null }], { initialEntries: [path] })
}

describe('session', () => {
  it.each([
    ['/reports?x=1', '/reports?x=1'],
    ['//evil.test', '/'],
    ['/\\evil.test', '/'],
    ['https://evil.test', '/'],
    ['/login', '/'],
    [42, '/'],
  ])('safeRedirect(%j) -> %s', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected)
  })

  it('clears every store and goes to login on 401', async () => {
    const db = setupFea()
    signIn(db)
    const info = vi.spyOn(platform.notify, 'info').mockImplementation(() => undefined)
    const r = router('/sales?tab=2')
    handleAuthFailure(r, 'unauthenticated')
    await vi.waitFor(() => expect(r.state.location.pathname).toBe('/login'))
    expect(r.state.location.state).toEqual({ from: '/sales?tab=2' })
    expect(useAuthStore.getState()).toMatchObject({
      status: 'anonymous',
      user: null,
      permissions: {},
    })
    expect(useCompanyStore.getState().companies).toEqual([])
    expect(info).toHaveBeenCalledWith('Oturumunuz sona erdi. Lütfen yeniden oturum açın.')
    info.mockRestore()
  })

  it('announces deactivation', () => {
    const db = setupFea()
    signIn(db)
    const error = vi.spyOn(platform.notify, 'error').mockImplementation(() => undefined)
    handleAuthFailure(router('/'), 'deactivated')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('devre dışı'))
    expect(useAuthStore.getState().status).toBe('anonymous')
    error.mockRestore()
  })

  it('keeps the session but forces the password page', async () => {
    const db = setupFea()
    signIn(db)
    const r = router('/')
    handleAuthFailure(r, 'passwordChangeRequired')
    await vi.waitFor(() => expect(r.state.location.pathname).toBe('/password/change'))
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(useAuthStore.getState().user?.mustChangePassword).toBe(true)
  })
})

describe('session lifecycle races', () => {
  it('ignores an /auth/me answer that arrives after the session ended', async () => {
    const db = setupFea()
    db.authenticated = true
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    server.use(
      http.get('*/api/v1/auth/me', async () => {
        await gate
        return HttpResponse.json({
          data: { user: db.user, companies: db.companies, permissions: db.permissions },
        })
      }),
    )
    const probe = loadSession()
    endSession()
    release()
    await expect(probe).resolves.toBeNull()
    expect(useAuthStore.getState()).toMatchObject({ status: 'anonymous', user: null })
    expect(useCompanyStore.getState().companies).toEqual([])
  })

  it('applies only the newest of two overlapping probes', async () => {
    const db = setupFea()
    db.authenticated = true
    let calls = 0
    let releaseFirst: () => void = () => undefined
    const firstGate = new Promise<void>((r) => (releaseFirst = r))
    server.use(
      http.get('*/api/v1/auth/me', async () => {
        calls += 1
        const permissions =
          calls === 1 ? { [db.companies[0]?.id ?? '']: ['old.perm'] } : db.permissions
        if (calls === 1) await firstGate
        return HttpResponse.json({ data: { user: db.user, companies: db.companies, permissions } })
      }),
    )
    const first = loadSession()
    const second = loadSession({ fresh: true })
    await second
    releaseFirst()
    await first
    expect(Object.values(useAuthStore.getState().permissions).flat()).not.toContain('old.perm')
  })
})

describe('logout', () => {
  it('keeps the session when the server does not confirm the logout', async () => {
    const db = setupFea()
    signIn(db)
    server.use(
      http.post('*/api/v1/auth/logout', () =>
        HttpResponse.json({ errors: { message: 'x', code: 'SERVER_ERROR' } }, { status: 500 }),
      ),
    )
    await expect(logout()).rejects.toMatchObject({ status: 500 })
    expect(useAuthStore.getState().status).toBe('authenticated')
  })

  it('treats 401 as already signed out and refreshes CSRF once on 419', async () => {
    const db = setupFea()
    signIn(db)
    let attempts = 0
    server.use(
      http.post('*/api/v1/auth/logout', () => {
        attempts += 1
        return attempts === 1
          ? HttpResponse.json({}, { status: 419 })
          : HttpResponse.json({}, { status: 401 })
      }),
    )
    await logout()
    expect(attempts).toBe(2)
    expect(db.calls.some((c) => c.path === '/sanctum/csrf-cookie')).toBe(true)
    expect(useAuthStore.getState().status).toBe('anonymous')
  })
})
