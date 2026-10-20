import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestOnly } from '@/app/guards'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { COMPANY_A, VALID_PASSWORD, VALID_RECOVERY, VALID_TOTP } from '@/test/handlers/fea'
import { renderRoutes, setupFea } from '@/test/handlers/feaRender'
import { LoginPage } from './LoginPage'

const routes = [
  { path: '/login', element: <LoginPage /> },
  { path: '/', element: <p>dashboard</p> },
  { path: '/password/change', element: <p>change-password</p> },
  { path: '/reports', element: <p>reports</p> },
]

async function submitCredentials(email = 'deniz@keystone.test', password = VALID_PASSWORD) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('E-posta'), email)
  await user.type(screen.getByLabelText('Parola'), password)
  await user.click(screen.getByRole('button', { name: 'Oturum aç' }))
  return user
}

describe('LoginPage', () => {
  it('shows Turkish validation messages', async () => {
    setupFea()
    const user = userEvent.setup()
    renderRoutes(routes, '/login')

    await user.click(screen.getByRole('button', { name: 'Oturum aç' }))

    expect(await screen.findByText('E-posta adresi gerekli.')).toBeInTheDocument()
    expect(screen.getByText('Parola en az 8 karakter olmalı.')).toBeInTheDocument()
    expect(screen.getByLabelText('E-posta')).toHaveAttribute('aria-invalid', 'true')
  })

  it('uses password-manager friendly autocomplete attributes', () => {
    setupFea()
    renderRoutes(routes, '/login')
    expect(screen.getByLabelText('E-posta')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('Parola')).toHaveAttribute('autocomplete', 'current-password')
  })

  it('primes CSRF, signs in, loads /auth/me and lands on the dashboard', async () => {
    const db = setupFea()
    const { router } = renderRoutes(routes, '/login')
    await submitCredentials()

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    const paths = db.calls.map((c) => c.path)
    expect(paths.indexOf('/sanctum/csrf-cookie')).toBeLessThan(paths.indexOf('/api/v1/auth/login'))
    expect(db.calls.find((c) => c.path === '/api/v1/auth/login')?.body).toEqual({
      email: 'deniz@keystone.test',
      password: VALID_PASSWORD,
      remember: true,
    })
    expect(useAuthStore.getState().user?.name).toBe('Deniz Kaya')
    expect(useCompanyStore.getState().activeCompanyId).toBe(COMPANY_A)
  })

  it('returns to the page that sent the user to login', async () => {
    setupFea()
    const { router } = renderRoutes(routes, '/login')
    await router.navigate('/login', { state: { from: '/reports' } })
    await submitCredentials()
    await waitFor(() => expect(router.state.location.pathname).toBe('/reports'))
  })

  it('maps server field errors onto the form', async () => {
    setupFea()
    renderRoutes(routes, '/login')
    await submitCredentials('deniz@keystone.test', 'wrong-password')
    expect(
      await screen.findByText('Bu bilgilerle eşleşen bir hesap bulunamadı.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('E-posta')).toHaveAttribute('aria-invalid', 'true')
    expect(useAuthStore.getState().status).not.toBe('authenticated')
  })

  it('explains a lockout', async () => {
    setupFea({ failedLogins: 5 })
    renderRoutes(routes, '/login')
    await submitCredentials()
    expect(await screen.findByRole('alert')).toHaveTextContent('Çok fazla deneme yapıldı')
  })

  it('asks for a TOTP code, rejects a wrong one and accepts the right one', async () => {
    const db = setupFea()
    db.user.two_factor_enabled = true
    const { router } = renderRoutes(routes, '/login')
    const user = await submitCredentials()

    const code = await screen.findByLabelText('Doğrulama kodu')
    expect(code).toHaveAttribute('autocomplete', 'one-time-code')
    expect(code).toHaveAttribute('inputmode', 'numeric')

    await user.type(code, '000000')
    await user.click(screen.getByRole('button', { name: 'Doğrula' }))
    expect(await screen.findByText('Kod geçersiz ya da süresi dolmuş.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Doğrulama kodu'))
    await user.type(screen.getByLabelText('Doğrulama kodu'), VALID_TOTP)
    await user.click(screen.getByRole('button', { name: 'Doğrula' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('accepts a recovery code instead', async () => {
    const db = setupFea()
    db.user.two_factor_enabled = true
    const { router } = renderRoutes(routes, '/login')
    const user = await submitCredentials()

    await user.click(await screen.findByRole('button', { name: 'Kurtarma kodu kullan' }))
    const input = screen.getByLabelText('Kurtarma kodu')
    expect(input).toHaveAttribute('autocomplete', 'off')
    await user.type(input, VALID_RECOVERY)
    await user.click(screen.getByRole('button', { name: 'Doğrula' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(db.calls.find((c) => c.path === '/api/v1/auth/two-factor/verify')?.body).toEqual({
      recovery_code: VALID_RECOVERY,
    })
  })

  it('validates the code format before calling the API', async () => {
    const db = setupFea()
    db.user.two_factor_enabled = true
    renderRoutes(routes, '/login')
    const user = await submitCredentials()
    await user.type(await screen.findByLabelText('Doğrulama kodu'), '12a')
    await user.click(screen.getByRole('button', { name: 'Doğrula' }))
    expect(await screen.findByText('6 haneli kodu girin.')).toBeInTheDocument()
    expect(db.calls.some((c) => c.path === '/api/v1/auth/two-factor/verify')).toBe(false)
  })

  it('sends a must-change-password account to the change page', async () => {
    const db = setupFea()
    db.user.must_change_password = true
    const { router } = renderRoutes(routes, '/login')
    await submitCredentials()
    await waitFor(() => expect(router.state.location.pathname).toBe('/password/change'))
  })

  it('redirects a live session away from login', async () => {
    const db = setupFea()
    db.authenticated = true
    const { router } = renderRoutes(
      [
        {
          path: '/login',
          element: <GuestOnly />,
          children: [{ index: true, element: <LoginPage /> }],
        },
        ...routes.slice(1),
      ],
      '/login',
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('never writes the password to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    setupFea()
    renderRoutes(routes, '/login')
    await submitCredentials('deniz@keystone.test', 'wrong-password')
    await screen.findByText('Bu bilgilerle eşleşen bir hesap bulunamadı.')
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain('wrong-password')
      spy.mockRestore()
    }
  })
})
