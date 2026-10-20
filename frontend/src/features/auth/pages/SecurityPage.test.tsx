import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAuthStore } from '@/stores/auth'
import { VALID_PASSWORD, VALID_TOTP } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { ForcePasswordChangePage } from './ForcePasswordChangePage'
import { SecurityPage } from './SecurityPage'

function renderSecurity() {
  return renderRoutes(
    [{ path: '/profile/security', element: <SecurityPage /> }],
    '/profile/security',
  )
}

// The change-password form on the same page shares the visible label.
const setupPassword = () => document.getElementById('setup-password')!

describe('SecurityPage', () => {
  it('sets up two-factor: QR as an image, confirm, recovery codes shown once', async () => {
    const db = setupFea()
    signIn(db)
    const user = userEvent.setup()
    renderSecurity()

    await user.click(screen.getByRole('button', { name: 'Kurulumu başlat' }))
    const start = await screen.findByRole('dialog')
    const startPassword = within(start).getByLabelText('Geçerli parola')
    expect(startPassword).toHaveAttribute('autocomplete', 'current-password')
    await user.type(startPassword, 'nope')
    await user.click(within(start).getByRole('button', { name: 'Devam et' }))
    expect(await within(start).findByText('Parola hatalı.')).toBeInTheDocument()
    expect(startPassword).toHaveValue('')
    await user.type(startPassword, VALID_PASSWORD)
    await user.click(within(start).getByRole('button', { name: 'Devam et' }))
    const qr = await screen.findByRole('img', { name: 'Doğrulama uygulamasıyla taranacak QR kodu' })
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()

    expect(setupPassword()).toHaveAttribute('autocomplete', 'current-password')
    await user.type(screen.getByLabelText('Doğrulama kodu'), '111111')
    await user.type(setupPassword(), 'nope')
    await user.click(screen.getByRole('button', { name: 'Onayla ve aç' }))
    expect(await screen.findByText('Parola hatalı.')).toBeInTheDocument()
    expect(setupPassword()).toHaveValue('')

    await user.type(setupPassword(), VALID_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Onayla ve aç' }))
    expect(await screen.findByText('Kod geçersiz ya da süresi dolmuş.')).toBeInTheDocument()
    expect(setupPassword()).toHaveValue('')

    await user.clear(screen.getByLabelText('Doğrulama kodu'))
    await user.type(screen.getByLabelText('Doğrulama kodu'), VALID_TOTP)
    await user.type(setupPassword(), VALID_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Onayla ve aç' }))

    const codes = await screen.findByRole('list', { name: 'Kurtarma kodları' })
    expect(within(codes).getAllByRole('listitem')).toHaveLength(2)
    expect(useAuthStore.getState().user?.twoFactorEnabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Kaydettim' }))
    expect(screen.queryByRole('list', { name: 'Kurtarma kodları' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Devre dışı bırak' })).toBeInTheDocument()
  })

  it('clears the typed password when the setup dialog is cancelled', async () => {
    const db = setupFea()
    signIn(db)
    const user = userEvent.setup()
    renderSecurity()

    await user.click(screen.getByRole('button', { name: 'Kurulumu başlat' }))
    let dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Geçerli parola'), 'secret')
    await user.click(within(dialog).getByRole('button', { name: 'Vazgeç' }))
    await user.click(screen.getByRole('button', { name: 'Kurulumu başlat' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Geçerli parola')).toHaveValue('')
    expect(db.calls.some((c) => c.path.endsWith('/two-factor/setup'))).toBe(false)
  })

  it('turns two-factor off after password confirmation', async () => {
    const db = setupFea()
    db.user.two_factor_enabled = true
    signIn(db)
    const user = userEvent.setup()
    renderSecurity()

    await user.click(screen.getByRole('button', { name: 'Devre dışı bırak' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Geçerli parola'), 'nope')
    await user.click(within(dialog).getByRole('button', { name: 'Devre dışı bırak' }))
    expect(await within(dialog).findByText('Parola hatalı.')).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Geçerli parola'))
    await user.type(within(dialog).getByLabelText('Geçerli parola'), VALID_PASSWORD)
    await user.click(within(dialog).getByRole('button', { name: 'Devre dışı bırak' }))
    await waitFor(() => expect(useAuthStore.getState().user?.twoFactorEnabled).toBe(false))
    expect(await screen.findByRole('button', { name: 'Kurulumu başlat' })).toBeInTheDocument()
  })

  it('lists sessions and revokes another device', async () => {
    const db = setupFea()
    signIn(db)
    const user = userEvent.setup()
    renderSecurity()

    expect(await screen.findByText('Chrome · Windows')).toBeInTheDocument()
    expect(screen.getByText('Bu oturum')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Safari · iOS oturumunu kapat' }))
    await waitFor(() => expect(screen.queryByText('Safari · iOS')).not.toBeInTheDocument())
    expect(db.calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/s-phone'))).toBe(true)
  })

  it('changes the password with matching confirmation and maps server errors', async () => {
    const db = setupFea()
    signIn(db)
    const user = userEvent.setup()
    renderSecurity()

    expect(screen.getByLabelText('Yeni parola')).toHaveAttribute('autocomplete', 'new-password')
    await user.type(screen.getByLabelText('Geçerli parola'), 'wrong-current')
    await user.type(screen.getByLabelText('Yeni parola'), 'brand-new-pass')
    await user.type(screen.getByLabelText('Yeni parola (tekrar)'), 'brand-new-pas')
    await user.click(screen.getByRole('button', { name: 'Parolayı güncelle' }))
    expect(await screen.findByText('Parolalar eşleşmiyor.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Yeni parola (tekrar)'), 's')
    await user.click(screen.getByRole('button', { name: 'Parolayı güncelle' }))
    expect(await screen.findByText('Geçerli parola hatalı.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Geçerli parola'))
    await user.type(screen.getByLabelText('Geçerli parola'), VALID_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Parolayı güncelle' }))
    await waitFor(() => expect(db.password).toBe('brand-new-pass'))
  })

  it('clears the typed password when the disable dialog is cancelled', async () => {
    const db = setupFea()
    db.user.two_factor_enabled = true
    signIn(db)
    const user = userEvent.setup()
    renderSecurity()

    await user.click(screen.getByRole('button', { name: 'Devre dışı bırak' }))
    let dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Geçerli parola'), 'secret-typed')
    await user.click(within(dialog).getByRole('button', { name: 'Vazgeç' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Devre dışı bırak' }))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Geçerli parola')).toHaveValue('')
  })
})

describe('ForcePasswordChangePage', () => {
  it('clears the flag and continues to the app', async () => {
    const db = setupFea()
    db.user.must_change_password = true
    signIn(db)
    const user = userEvent.setup()
    const { router } = renderRoutes(
      [
        { path: '/password/change', element: <ForcePasswordChangePage /> },
        { path: '/', element: <p>home</p> },
      ],
      '/password/change',
    )
    await user.type(screen.getByLabelText('Geçerli parola'), VALID_PASSWORD)
    await user.type(screen.getByLabelText('Yeni parola'), 'brand-new-pass')
    await user.type(screen.getByLabelText('Yeni parola (tekrar)'), 'brand-new-pass')
    await user.click(screen.getByRole('button', { name: 'Parolayı belirle ve devam et' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(useAuthStore.getState().user?.mustChangePassword).toBe(false)
  })
})
