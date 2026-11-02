import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { fail, type CommandHandler } from '../../test/fakeBridge'
import { harness, renderApp, renderGate, useTurkish } from './testing'

beforeEach(useTurkish)

const NOTICE = 'Bu cihazda çıkış yapıldı, ancak sunucudaki oturum kapatılamadı. Güvenlik sayfasından bu cihazın oturumunu kapatın.'

const signOut =
  (revoked: boolean): CommandHandler =>
  () => ({ status: 'done', server_revoked: revoked })

describe('SignOutNotice', () => {
  it('after the local sign-out, says the server session is still open and stays on the sign-in page', async () => {
    const h = harness({ auth_sign_out: signOut(false) })
    const { router } = renderApp(h, '/password/change')
    await userEvent.click(await screen.findByRole('button', { name: 'Değiştirdim, yeniden gir' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    const notice = await screen.findByTestId('sign-out-notice')
    expect(notice).toHaveAttribute('role', 'alert')
    expect(notice).toHaveTextContent(NOTICE)
  })

  it('opens the web security page by its name', async () => {
    const h = harness({ auth_sign_out: signOut(false), open_external: () => null })
    renderGate(h)
    await act(() => h.platform.session.logout())
    const notice = await screen.findByTestId('sign-out-notice')
    await userEvent.click(within(notice).getByRole('button', { name: 'Güvenlik sayfasını aç' }))
    await waitFor(() => {
      expect(h.bridge.callsOf('open_external').map((c) => c.args)).toEqual([{ target: 'security' }])
    })
  })

  it('reports a browser that did not open', async () => {
    const h = harness({ auth_sign_out: signOut(false), open_external: () => fail('EXTERNAL_OPEN_FAILED') })
    renderGate(h)
    await act(() => h.platform.session.logout())
    const notice = await screen.findByTestId('sign-out-notice')
    await userEvent.click(within(notice).getByRole('button', { name: 'Güvenlik sayfasını aç' }))
    expect(await within(notice).findByText('Tarayıcı açılamadı.')).toBeInTheDocument()
  })

  it('can be dismissed', async () => {
    const h = harness({ auth_sign_out: signOut(false) })
    renderGate(h)
    await act(() => h.platform.session.logout())
    await userEvent.click(await screen.findByRole('button', { name: 'Kapat' }))
    expect(screen.queryByTestId('sign-out-notice')).not.toBeInTheDocument()
  })

  it('is not shown when the server ended the sign-in', async () => {
    const h = harness({ auth_sign_out: signOut(true) })
    renderGate(h)
    await act(() => h.platform.session.logout())
    expect(await screen.findByText('web app')).toBeInTheDocument()
    expect(screen.queryByTestId('sign-out-notice')).not.toBeInTheDocument()
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument()
  })

  it('goes away after a later sign-out the server confirmed', async () => {
    let revoked = false
    const h = harness({ auth_sign_out: () => ({ status: 'done', server_revoked: revoked }) })
    renderGate(h)
    await act(() => h.platform.session.logout())
    expect(await screen.findByTestId('sign-out-notice')).toBeInTheDocument()
    revoked = true
    await act(() => h.platform.session.logout())
    expect(screen.queryByTestId('sign-out-notice')).not.toBeInTheDocument()
  })

  it('is not shown when unsent work was kept', async () => {
    const h = harness({ auth_sign_out: () => ({ status: 'pending_work', outbox: 1, conflicts: 0 }) })
    const { router } = renderApp(h, '/password/change')
    await userEvent.click(await screen.findByRole('button', { name: 'Değiştirdim, yeniden gir' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vazgeç' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(router.state.location.pathname).toBe('/password/change')
    expect(screen.queryByTestId('sign-out-notice')).not.toBeInTheDocument()
  })
})
