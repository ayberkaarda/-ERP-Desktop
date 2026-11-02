import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCompanyStore } from '@/stores/company'
import { fail } from '../../test/fakeBridge'
import { harness, loginDto, PROFILE, renderApp, USER, useTurkish } from './testing'

vi.mock('@/platform/runtime', () => import('./quietRuntime'))

beforeEach(async () => {
  await useTurkish()
  useCompanyStore.setState({ companies: [], activeCompanyId: null })
})

const SECRET = 'çok-gizli-parola'

async function signIn(email = 'ada@example.test', password = SECRET) {
  await userEvent.type(await screen.findByLabelText('E-posta'), email)
  await userEvent.type(screen.getByLabelText('Parola'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }))
}

describe('DesktopLoginPage', () => {
  it('names the active profile and links to the profiles', async () => {
    renderApp(harness(), '/login')
    expect(await screen.findByText('Sunucu: Merkez')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Değiştir' })).toHaveAttribute('href', '/setup')
  })

  it('signs in, loads the web session and goes where the user came from', async () => {
    const h = harness({ auth_login: () => loginDto() })
    const { router } = renderApp(h, '/login', { from: '/elsewhere' })
    await signIn()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/elsewhere')
    })
    expect(h.bridge.callsOf('auth_login').map((c) => c.args)).toEqual([
      { email: 'ada@example.test', password: SECRET },
    ])
    expect(h.session.load).toHaveBeenCalledTimes(1)
    expect(useCompanyStore.getState().activeCompanyId).toBe('c1')
  })

  it('does not follow a redirect outside the app', async () => {
    const { router } = renderApp(harness({ auth_login: () => loginDto() }), '/login', { from: '//evil.test' })
    await signIn()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })

  it('asks for the second factor and repeats the sign-in with the same password', async () => {
    const h = harness({
      auth_login: (args) => (args?.twoFactorCode === undefined ? fail('TWO_FACTOR_REQUIRED') : loginDto()),
    })
    const { router } = renderApp(h, '/login')
    await signIn()
    expect(await screen.findByRole('heading', { name: 'İki adımlı doğrulama' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Parola')).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(SECRET)

    await userEvent.type(screen.getByLabelText('Doğrulama kodu'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Doğrula' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(h.bridge.callsOf('auth_login').map((c) => c.args)).toEqual([
      { email: 'ada@example.test', password: SECRET },
      { email: 'ada@example.test', password: SECRET, twoFactorCode: '123456' },
    ])
  })

  it('a wrong code stays on the code step and keeps the password for the next try', async () => {
    let calls = 0
    const h = harness({
      auth_login: (args) => {
        calls += 1
        if (args?.twoFactorCode === undefined) fail('TWO_FACTOR_REQUIRED')
        if (calls === 2) fail('INVALID_TWO_FACTOR_CODE', `wrong ${String(args.password)}`)
        return loginDto()
      },
    })
    renderApp(h, '/login')
    await signIn()
    await userEvent.type(await screen.findByLabelText('Doğrulama kodu'), '111111')
    await userEvent.click(screen.getByRole('button', { name: 'Doğrula' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Doğrulama kodu hatalı.')
    expect(document.body.innerHTML).not.toContain(SECRET)
    expect(screen.getByLabelText('Doğrulama kodu')).toHaveValue('')
    await userEvent.type(screen.getByLabelText('Doğrulama kodu'), '222222')
    await userEvent.click(screen.getByRole('button', { name: 'Doğrula' }))
    await waitFor(() => {
      expect(h.bridge.callsOf('auth_login')).toHaveLength(3)
    })
    expect(h.bridge.callsOf('auth_login')[2]?.args).toEqual({
      email: 'ada@example.test',
      password: SECRET,
      twoFactorCode: '222222',
    })
  })

  it('going back from the code step forgets the password', async () => {
    const h = harness({ auth_login: () => fail('TWO_FACTOR_REQUIRED') })
    renderApp(h, '/login')
    await signIn()
    await userEvent.click(await screen.findByRole('button', { name: 'Geri' }))
    expect(await screen.findByLabelText('Parola')).toHaveValue('')
    expect(screen.getByLabelText('E-posta')).toHaveValue('ada@example.test')
    await userEvent.type(screen.getByLabelText('Parola'), 'yeni')
    await userEvent.click(screen.getByRole('button', { name: 'Giriş yap' }))
    await waitFor(() => {
      expect(h.bridge.callsOf('auth_login')).toHaveLength(2)
    })
    expect(h.bridge.callsOf('auth_login')[1]?.args).toEqual({ email: 'ada@example.test', password: 'yeni' })
  })

  it('a user with several companies chooses one first', async () => {
    const companies = [
      { id: 'c1', name: 'Ana Şirket' },
      { id: 'c2', name: 'Yan Şirket' },
    ]
    const h = harness({
      auth_login: () => loginDto({ companies, company_required: true, profile: { ...PROFILE, company_id: null } }),
      profile_select_company: (args) => loginDto({ companies, profile: { ...PROFILE, company_id: String(args?.company) } }),
    })
    const { router } = renderApp(h, '/login')
    await signIn()
    expect(await screen.findByRole('heading', { name: 'Şirket seçin' })).toBeInTheDocument()
    expect(h.session.load).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Yan Şirket' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(h.bridge.callsOf('profile_select_company').map((c) => c.args)).toEqual([{ company: 'c2', force: false }])
    expect(h.session.load).toHaveBeenCalledTimes(1)
    expect(useCompanyStore.getState().activeCompanyId).toBe('c2')
  })

  it('a company choice blocked by unsent work asks and repeats with force', async () => {
    const companies = [
      { id: 'c1', name: 'Ana Şirket' },
      { id: 'c2', name: 'Yan Şirket' },
    ]
    let calls = 0
    const h = harness({
      auth_login: () => loginDto({ companies, company_required: true }),
      profile_select_company: () => {
        calls += 1
        if (calls === 1) fail('PROFILE_HAS_PENDING_WORK', '1 unsent changes and 0 open conflicts')
        return loginDto({ companies, profile: { ...PROFILE, company_id: 'c2' } })
      },
    })
    renderApp(h, '/login')
    await signIn()
    await userEvent.click(await screen.findByRole('button', { name: 'Yan Şirket' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Yine de devam et (silinir)' }))
    await waitFor(() => {
      expect(h.bridge.callsOf('profile_select_company').map((c) => c.args)).toEqual([
        { company: 'c2', force: false },
        { company: 'c2', force: true },
      ])
    })
  })

  it('sends a user who must change the password to the password page', async () => {
    const h = harness({
      auth_login: () => loginDto({ user: { id: 'u1', name: 'Ada', email: 'a@x.test', must_change_password: true } }),
    })
    h.session.load.mockResolvedValue({ ...USER, mustChangePassword: true })
    const { router } = renderApp(h, '/login', { from: '/elsewhere' })
    await signIn()
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/password/change')
    })
  })

  it('reports a session that could not be loaded', async () => {
    const h = harness({ auth_login: () => loginDto() })
    h.session.load.mockResolvedValue(null)
    const { router } = renderApp(h, '/login')
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent('Oturum bilgisi alınamadı.')
    expect(router.state.location.pathname).toBe('/login')
  })

  it.each([
    ['UNAUTHENTICATED', 'E-posta ya da parola hatalı.'],
    ['NETWORK_ERROR', 'Sunucuya ulaşılamadı.'],
    ['TOO_MANY_ATTEMPTS', 'Çok fazla deneme.'],
  ])('shows %s and clears the password field', async (code, text) => {
    renderApp(harness({ auth_login: () => fail(code, 'server said no') }), '/login')
    await signIn()
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.getByLabelText('Parola')).toHaveValue('')
    expect(document.body.innerHTML).not.toContain(SECRET)
  })
})
