import { createMemoryRouter } from 'react-router'
import { platform } from '@/platform'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { setupFea, signIn } from '@/test/handlers/feaRender'
import { handleAuthFailure, safeRedirect } from './session'

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
