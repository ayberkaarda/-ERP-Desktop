import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { fail } from '../../test/fakeBridge'
import { harness, renderApp, useTurkish } from './testing'

beforeEach(useTurkish)

describe('ExternalPasswordChangePage', () => {
  it('has no password form', async () => {
    renderApp(harness(), '/password/change')
    expect(await screen.findByRole('heading', { name: 'Parolanızı değiştirin' })).toBeInTheDocument()
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })

  it('opens the web page by its name only', async () => {
    const h = harness({ open_external: () => null })
    renderApp(h, '/password/change')
    await userEvent.click(await screen.findByRole('button', { name: "Web'de değiştir" }))
    await waitFor(() => {
      expect(h.bridge.callsOf('open_external').map((c) => c.args)).toEqual([{ target: 'password_change' }])
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Tarayıcıda açıldı.')
  })

  it('reports a browser that did not open', async () => {
    renderApp(harness({ open_external: () => fail('EXTERNAL_OPEN_FAILED') }), '/password/change')
    await userEvent.click(await screen.findByRole('button', { name: "Web'de değiştir" }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tarayıcı açılamadı.')
  })

  it('"changed it" signs out without force and goes to the sign-in', async () => {
    const h = harness({ auth_sign_out: () => ({ status: 'done', server_revoked: true }) })
    const { router } = renderApp(h, '/password/change')
    await userEvent.click(await screen.findByRole('button', { name: 'Değiştirdim, yeniden gir' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(h.bridge.callsOf('auth_sign_out').map((c) => c.args)).toEqual([{ force: false }])
  })

  it('unsent work: the dialog shows the counts and discard repeats with force', async () => {
    const h = harness({
      auth_sign_out: (args) => (args?.force ? { status: 'done', server_revoked: true } : { status: 'pending_work', outbox: 5, conflicts: 2 }),
    })
    const { router } = renderApp(h, '/password/change')
    await userEvent.click(await screen.findByRole('button', { name: 'Değiştirdim, yeniden gir' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Gönderilmemiş iş var' })
    expect(dialog).toHaveTextContent('5 gönderilmemiş değişiklik, 2 açık çakışma')
    expect(dialog).toHaveTextContent('Çıkış yapılıyor.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yine de devam et (silinir)' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(h.bridge.callsOf('auth_sign_out').map((c) => c.args)).toEqual([{ force: false }, { force: true }])
  })

  it('unsent work kept: no second call and the page stays', async () => {
    const h = harness({ auth_sign_out: () => ({ status: 'pending_work', outbox: 1, conflicts: 0 }) })
    const { router } = renderApp(h, '/password/change')
    await userEvent.click(await screen.findByRole('button', { name: 'Değiştirdim, yeniden gir' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vazgeç' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(router.state.location.pathname).toBe('/password/change')
    expect(h.bridge.callsOf('auth_sign_out')).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('unsent work: "show" keeps the work and opens the outbox', async () => {
    const h = harness({ auth_sign_out: () => ({ status: 'pending_work', outbox: 1, conflicts: 0 }) })
    renderApp(h, '/password/change')
    await userEvent.click(await screen.findByRole('button', { name: 'Değiştirdim, yeniden gir' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Bekleyen işleri göster' }))
    await waitFor(() => {
      expect(h.openPath).toHaveBeenCalledWith('/sync/outbox')
    })
    expect(h.bridge.callsOf('auth_sign_out')).toHaveLength(1)
  })

  it('a failed sign-out is shown', async () => {
    renderApp(harness({ auth_sign_out: () => fail('NETWORK_ERROR') }), '/password/change')
    await userEvent.click(await screen.findByRole('button', { name: 'Değiştirdim, yeniden gir' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucuya ulaşılamadı.')
  })
})
