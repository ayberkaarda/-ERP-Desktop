import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { fail } from '../../test/fakeBridge'
import { harness, loginDto, renderApp, USER, useTurkish } from './testing'

beforeEach(useTurkish)

const SECRET = 'çok-gizli-parola'
async function signIn() {
  await userEvent.type(await screen.findByLabelText('E-posta'), 'ada@example.test')
  await userEvent.type(screen.getByLabelText('Parola'), SECRET)
  await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }))
}

describe('DesktopLoginPage: code, password change and redirects', () => {
  it('trims the second factor code', async () => {
    const h = harness({ auth_login: (a) => (a?.twoFactorCode === undefined ? fail('TWO_FACTOR_REQUIRED') : loginDto()) })
    renderApp(h, '/login')
    await signIn()
    await userEvent.type(await screen.findByLabelText('Doğrulama kodu'), ' 123456 ')
    await userEvent.click(screen.getByRole('button', { name: 'Doğrula' }))
    await waitFor(() => {
      expect(h.bridge.callsOf('auth_login')).toHaveLength(2)
    })
    expect(h.bridge.callsOf('auth_login')[1]?.args?.twoFactorCode).toBe('123456')
  })

  it('must_change_password of the sign-in answer alone is enough', async () => {
    const h = harness({
      auth_login: () => loginDto({ user: { id: 'u1', name: 'Ada', email: 'a@x.test', must_change_password: true } }),
    })
    const { router } = renderApp(h, '/login')
    await signIn()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/password/change')
    })
  })

  it('mustChangePassword of /auth/me alone is enough', async () => {
    const h = harness({ auth_login: () => loginDto() })
    h.session.load.mockResolvedValue({ ...USER, mustChangePassword: true })
    const { router } = renderApp(h, '/login')
    await signIn()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/password/change')
    })
  })

  it.each(['https://evil.test/x', 'javascript:alert(1)', '/\\evil.test', '/login?x=1'])(
    'does not follow the redirect %s',
    async (from) => {
      const { router } = renderApp(harness({ auth_login: () => loginDto() }), '/login', { from })
      await signIn()
      await waitFor(() => {
        expect(pathOf(router)).toBe('/')
      })
    },
  )
})

function pathOf(router: { state: { location: { pathname: string } } }) {
  return router.state.location.pathname
}
