import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'

import { Providers } from '@/app/providers'
import type { ProfilesDto } from '../../bridge/generated/ProfilesDto'
import { deferred, fail, flush } from '../../test/fakeBridge'
import { DesktopLoginPage } from './DesktopLoginPage'
import { DesktopSecurityExtras } from './DesktopSecurityExtras'
import { ExternalPasswordChangePage } from './ExternalPasswordChangePage'
import { SetupPage } from './ProfilesPage'
import { harness, PROFILE, renderApp, renderGate, useTurkish } from './testing'

beforeEach(useTurkish)

describe('gate safety', () => {
  it('a state answer with an unknown phase is not the web app', async () => {
    renderGate(harness({ profile_state: () => ({ profile_id: 'p1', phase: 'exploded' }) }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Profil durumu okunamadı.')
    expect(screen.queryByText('web app')).not.toBeInTheDocument()
  })

  it('on its own screens the pending-work dialog offers no outbox link', async () => {
    const h = harness({
      profile_state: () => ({ profile_id: 'p1', phase: 'failed', error: { code: 'PROFILE_RECORD_MALFORMED', message: 'x' } }),
      profile_remove: () => fail('PROFILE_HAS_PENDING_WORK', '2 unsent changes and 0 open conflicts'),
    })
    renderGate(h)
    await userEvent.click(await screen.findByRole('button', { name: 'Profili sil' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Profili sil' }))
    const pending = await screen.findByRole('alertdialog', { name: 'Gönderilmemiş iş var' })
    expect(within(pending).queryByRole('button', { name: 'Bekleyen işleri göster' })).not.toBeInTheDocument()
    expect(within(pending).getByRole('button', { name: 'Vazgeç' })).toBeInTheDocument()
  })

  it('the lost-key screen also leads to the server profiles', async () => {
    renderGate(
      harness({
        profile_state: () => ({ profile_id: 'p1', phase: 'engineless', error: { code: 'STORE_KEY_INVALID', message: 'x' } }),
      }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Sunucu profilleri' }))
    expect(await screen.findByRole('heading', { name: 'Sunucu profilleri' })).toBeInTheDocument()
  })

  it('the lost-key confirmation ignores surrounding spaces', async () => {
    const h = harness({
      profile_state: () => ({ profile_id: 'p1', phase: 'failed', error: { code: 'STORE_KEY_INVALID', message: 'x' } }),
      profile_reset: () => PROFILE,
    })
    renderGate(h)
    await userEvent.type(await screen.findByLabelText(/Onaylamak için/), ' Merkez ')
    expect(screen.getByRole('button', { name: 'Bu profilin yerel verisini sıfırla' })).toBeEnabled()
  })
})

describe('sign-in page while the profiles load', () => {
  it('says nothing about a missing profile before the list arrived', async () => {
    const list = deferred<ProfilesDto>()
    const h = harness({ profile_list: () => list.promise })
    renderApp(h, '/login')
    await screen.findByLabelText('E-posta')
    await flush()
    expect(screen.queryByText('Önce bir sunucu profili seçin.')).not.toBeInTheDocument()
    list.resolve({ active_id: 'p1', profiles: [PROFILE] })
    expect(await screen.findByText('Sunucu: Merkez')).toBeInTheDocument()
  })
})

describe('account pages outside the desktop window', () => {
  function renderBare(path: string) {
    const router = createMemoryRouter(
      [
        { path: '/login', element: <DesktopLoginPage /> },
        { path: '/setup', element: <SetupPage /> },
        { path: '/password/change', element: <ExternalPasswordChangePage /> },
        { path: '/profile/security', element: <div data-testid="security"><DesktopSecurityExtras /></div> },
      ],
      { initialEntries: [path] },
    )
    return render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    )
  }

  it.each(['/login', '/setup', '/password/change'])('%s asks for the desktop app instead of failing', async (path) => {
    renderBare(path)
    expect(await screen.findByRole('heading', { name: 'Masaüstü uygulaması gerekli' })).toBeInTheDocument()
  })

  it('the security extras stay empty', async () => {
    renderBare('/profile/security')
    await waitFor(() => {
      expect(screen.getByTestId('security')).toBeEmptyDOMElement()
    })
  })
})

describe('screens read the shell once, not on every render', () => {
  it.each([
    ['/setup', ['profile_list', 'app_info']],
    ['/login', ['profile_list']],
    ['/profile/security', ['auth_devices_list', 'app_info']],
  ])('%s', async (path, commands) => {
    const h = harness({ auth_devices_list: () => [] })
    renderApp(h, path)
    await waitFor(() => {
      for (const command of commands) expect(h.bridge.callsOf(command).length).toBeGreaterThan(0)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const settled = h.bridge.calls.length
    await new Promise((resolve) => setTimeout(resolve, 300))
    // The platform reads profile_list once by itself; the screens add one read each.
    expect(h.bridge.calls.length).toBe(settled)
    for (const command of commands) expect(h.bridge.callsOf(command).length).toBeLessThanOrEqual(2)
    expect(h.bridge.callsOf('profile_state')).toHaveLength(1)
  })
})
