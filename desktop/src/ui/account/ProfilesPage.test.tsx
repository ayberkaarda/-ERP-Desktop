import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fail } from '../../test/fakeBridge'
import { harness, OTHER, PROFILE, renderApp, renderGate, useTurkish } from './testing'

vi.mock('@/platform/runtime', () => import('./quietRuntime'))

beforeEach(useTurkish)

async function addServer(url: string, name = '') {
  await userEvent.type(await screen.findByLabelText('Sunucu adresi'), url)
  if (name) await userEvent.type(screen.getByLabelText('Profil adı (isteğe bağlı)'), name)
  await userEvent.click(screen.getByRole('button', { name: 'Ekle' }))
}

describe('ProfilesPage', () => {
  it('lists the profiles with server, version, realtime and the active one', async () => {
    renderApp(harness(), '/setup')
    const first = await screen.findByRole('listitem', { name: 'Merkez' })
    expect(first).toHaveTextContent('http://localhost:8000')
    expect(first).toHaveTextContent('Keystone 1.4.0')
    expect(first).toHaveTextContent('Anlık bildirim var')
    expect(first).toHaveTextContent('Etkin')
    const second = screen.getByRole('listitem', { name: 'Şube' })
    expect(second).toHaveTextContent('Anlık bildirim yok')
    expect(second).not.toHaveTextContent('Etkin')
    expect(within(first).queryByRole('button', { name: 'Bu profile geç' })).not.toBeInTheDocument()
  })

  it('adds a server profile with its address and name', async () => {
    const h = harness({ profile_add: () => OTHER })
    renderApp(h, '/setup')
    await addServer('https://erp.example.test', 'Şube')
    await waitFor(() => {
      expect(h.bridge.callsOf('profile_add').map((c) => c.args)).toEqual([
        { url: 'https://erp.example.test', name: 'Şube' },
      ])
    })
    expect(h.bridge.callsOf('profile_select')).toHaveLength(0)
  })

  it('sends no name when none was typed', async () => {
    const h = harness({ profile_add: () => OTHER })
    renderApp(h, '/setup')
    await addServer('https://erp.example.test')
    await waitFor(() => {
      expect(h.bridge.callsOf('profile_add').map((c) => c.args)).toEqual([{ url: 'https://erp.example.test', name: null }])
    })
  })

  it.each([
    ['INVALID_SERVER_URL', 'Sunucu adresi geçersiz.'],
    ['DESKTOP_UPDATE_REQUIRED', 'Bu sunucu uygulamanın daha yeni bir sürümünü istiyor.'],
    ['SYNC_SCHEMA_MISMATCH', 'Sunucunun eşitleme şeması bu uygulamayla uyumlu değil.'],
    ['NETWORK_ERROR', 'Sunucuya ulaşılamadı.'],
    ['PROFILES_FILE_INVALID', 'Profil dosyası okunamadı ya da yazılamadı; dosyaya dokunulmadı.'],
  ])('shows %s from profile_add', async (code, text) => {
    const h = harness({ profile_add: () => fail(code, 'shell message') })
    renderApp(h, '/setup')
    await addServer('http://localhost:8000')
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })

  it('shows an unknown code by name', async () => {
    renderApp(harness({ profile_add: () => fail('SOMETHING_NEW') }), '/setup')
    await addServer('http://localhost:8000')
    expect(await screen.findByRole('alert')).toHaveTextContent('İşlem tamamlanamadı (SOMETHING_NEW).')
  })

  it('opens the first profile right after it was added', async () => {
    let active: string | null = null
    const h = harness({
      profile_state: () => (active ? { profile_id: active, phase: 'ready' } : { phase: 'none' }),
      profile_list: () => ({ active_id: active, profiles: active ? [PROFILE] : [] }),
      profile_add: () => PROFILE,
      profile_select: (args) => {
        active = String(args?.id)
        return PROFILE
      },
    })
    renderGate(h)
    expect(await screen.findByText('Henüz profil yok.')).toBeInTheDocument()
    await addServer('http://localhost:8000')
    await screen.findByText('web app')
    expect(h.bridge.callsOf('profile_select').map((c) => c.args)).toEqual([{ id: 'p1' }])
  })

  it('notes plain http only for a development build', async () => {
    renderApp(harness(), '/setup')
    expect(await screen.findByText(/KEYSTONE_DEV_ALLOW_HTTP=1/)).toBeInTheDocument()
    expect(screen.getByLabelText('Sunucu adresi')).toHaveAttribute('placeholder', 'http://localhost:8000')
  })

  it('asks for https in a release build', async () => {
    renderApp(
      harness({
        app_info: () => ({ name: 'K', version: '1', identifier: 'x', sync_schema_version: 1, os: 'windows', debug: false }),
      }),
      '/setup',
    )
    expect(await screen.findByText('Adres https:// ile başlamalıdır.')).toBeInTheDocument()
    expect(screen.queryByText(/KEYSTONE_DEV_ALLOW_HTTP/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Sunucu adresi')).toHaveAttribute('placeholder', 'https://erp.example.test')
  })

  it('switches to another profile and drops the web session', async () => {
    const h = harness({ profile_select: () => OTHER })
    const { router } = renderApp(h, '/setup')
    const item = await screen.findByRole('listitem', { name: 'Şube' })
    await userEvent.click(within(item).getByRole('button', { name: 'Bu profile geç' }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(h.bridge.callsOf('profile_select').map((c) => c.args)).toEqual([{ id: 'p2' }])
    expect(h.session.end).toHaveBeenCalled()
  })

  it('refreshes the server facts of a profile', async () => {
    const h = harness({ profile_refresh_meta: () => ({ ...OTHER, server_version: '1.6.0' }) })
    renderApp(h, '/setup')
    const item = await screen.findByRole('listitem', { name: 'Şube' })
    await userEvent.click(within(item).getByRole('button', { name: 'Sunucu bilgisini yenile' }))
    await waitFor(() => {
      expect(h.bridge.callsOf('profile_refresh_meta').map((c) => c.args)).toEqual([{ id: 'p2' }])
    })
  })

  it('removes a profile after confirmation', async () => {
    const h = harness({ profile_remove: () => null })
    renderApp(h, '/setup')
    const item = await screen.findByRole('listitem', { name: 'Şube' })
    await userEvent.click(within(item).getByRole('button', { name: 'Sil' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Profil silinsin mi?' })
    expect(dialog).toHaveTextContent('Şube')
    expect(h.bridge.callsOf('profile_remove')).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sil' }))
    await waitFor(() => {
      expect(h.bridge.callsOf('profile_remove').map((c) => c.args)).toEqual([{ id: 'p2', force: false }])
    })
  })

  it('a removal with unsent work asks and repeats with force', async () => {
    let calls = 0
    const h = harness({
      profile_remove: () => {
        calls += 1
        if (calls === 1) fail('PROFILE_HAS_PENDING_WORK', '4 unsent changes and 2 open conflicts')
        return null
      },
    })
    renderApp(h, '/setup')
    const item = await screen.findByRole('listitem', { name: 'Şube' })
    await userEvent.click(within(item).getByRole('button', { name: 'Sil' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sil' }))
    const pending = await screen.findByRole('alertdialog', { name: 'Gönderilmemiş iş var' })
    expect(pending).toHaveTextContent('4 gönderilmemiş değişiklik, 2 açık çakışma')
    expect(pending).toHaveTextContent('Profil siliniyor.')
    await userEvent.click(within(pending).getByRole('button', { name: 'Yine de devam et (silinir)' }))
    await waitFor(() => {
      expect(h.bridge.callsOf('profile_remove').map((c) => c.args)).toEqual([
        { id: 'p2', force: false },
        { id: 'p2', force: true },
      ])
    })
  })

  it('a removal kept by the user is not repeated', async () => {
    const h = harness({ profile_remove: () => fail('PROFILE_HAS_PENDING_WORK', 'work') })
    renderApp(h, '/setup')
    const item = await screen.findByRole('listitem', { name: 'Şube' })
    await userEvent.click(within(item).getByRole('button', { name: 'Sil' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sil' }))
    const pending = await screen.findByRole('alertdialog', { name: 'Gönderilmemiş iş var' })
    expect(pending).toHaveTextContent('Gönderilmemiş değişiklikler ya da açık çakışmalar var.')
    await userEvent.click(within(pending).getByRole('button', { name: 'Vazgeç' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Gönderilmemiş iş var' })).not.toBeInTheDocument()
    })
    expect(h.bridge.callsOf('profile_remove')).toHaveLength(1)
  })

  it('a busy profile can be tried again', async () => {
    let calls = 0
    const h = harness({
      profile_remove: () => {
        calls += 1
        if (calls === 1) fail('PROFILE_BUSY')
        return null
      },
    })
    renderApp(h, '/setup')
    const item = await screen.findByRole('listitem', { name: 'Şube' })
    await userEvent.click(within(item).getByRole('button', { name: 'Sil' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sil' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Profilin bir isteği sürüyor')
    await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }))
    await waitFor(() => {
      expect(h.bridge.callsOf('profile_remove').map((c) => c.args)).toEqual([
        { id: 'p2', force: false },
        { id: 'p2', force: false },
      ])
    })
  })
})
