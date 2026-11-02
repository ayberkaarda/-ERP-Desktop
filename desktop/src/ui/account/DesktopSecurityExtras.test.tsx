import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeviceDto } from '../../bridge/generated/DeviceDto'
import { fail } from '../../test/fakeBridge'
import { harness, renderApp, useTurkish } from './testing'

vi.mock('@/platform/runtime', () => import('./quietRuntime'))

beforeEach(useTurkish)

const DEVICES: DeviceDto[] = [
  {
    id: 'd1',
    name: 'OFIS-PC',
    ip_address: '10.0.0.5',
    user_agent: null,
    last_used_at: '2026-11-01T09:00:00Z',
    expires_at: '2026-12-01T09:00:00Z',
    created_at: '2026-10-01T09:00:00Z',
  },
  {
    id: 'd2',
    name: 'LAPTOP',
    ip_address: null,
    user_agent: null,
    last_used_at: null,
    expires_at: '2026-12-01T09:00:00Z',
    created_at: null,
  },
]

describe('DesktopSecurityExtras', () => {
  it('lists the device sign-ins', async () => {
    renderApp(harness({ auth_devices_list: () => DEVICES }), '/profile/security')
    const office = await screen.findByRole('listitem', { name: 'OFIS-PC' })
    expect(office).toHaveTextContent('10.0.0.5')
    expect(screen.getByRole('listitem', { name: 'LAPTOP' })).toHaveTextContent('Henüz kullanılmadı')
  })

  it('ends a device sign-in after confirmation and reads the list again', async () => {
    let devices = DEVICES
    const h = harness({
      auth_devices_list: () => devices,
      auth_devices_revoke: (args) => {
        devices = devices.filter((d) => d.id !== args?.id)
        return null
      },
    })
    renderApp(h, '/profile/security')
    const laptop = await screen.findByRole('listitem', { name: 'LAPTOP' })
    await userEvent.click(within(laptop).getByRole('button', { name: 'Oturumu kapat' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Cihaz oturumu kapatılsın mı?' })
    expect(h.bridge.callsOf('auth_devices_revoke')).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Oturumu kapat' }))
    await waitFor(() => {
      expect(screen.queryByRole('listitem', { name: 'LAPTOP' })).not.toBeInTheDocument()
    })
    expect(h.bridge.callsOf('auth_devices_revoke').map((c) => c.args)).toEqual([{ id: 'd2' }])
    expect(h.bridge.callsOf('auth_devices_list').length).toBeGreaterThanOrEqual(2)
  })

  it('shows a device list that could not be read', async () => {
    renderApp(harness({ auth_devices_list: () => fail('NETWORK_ERROR') }), '/profile/security')
    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucuya ulaşılamadı.')
  })

  it('opens the web security page by its name only', async () => {
    const h = harness({ auth_devices_list: () => [], open_external: () => null })
    renderApp(h, '/profile/security')
    await userEvent.click(await screen.findByRole('button', { name: "Web'de yönet" }))
    await waitFor(() => {
      expect(h.bridge.callsOf('open_external').map((c) => c.args)).toEqual([{ target: 'security' }])
    })
  })

  it('tells about the app from app_info', async () => {
    renderApp(harness({ auth_devices_list: () => [] }), '/profile/security')
    const about = await screen.findByRole('region', { name: 'Hakkında' })
    await waitFor(() => {
      expect(about).toHaveTextContent('0.1.0')
    })
    expect(about).toHaveTextContent('Eşitleme şeması1')
    expect(about).toHaveTextContent('windows')
    expect(about).toHaveTextContent('Geliştirme')
  })

  it('links to the server profiles', async () => {
    renderApp(harness({ auth_devices_list: () => [] }), '/profile/security')
    expect(await screen.findByRole('link', { name: 'Sunucu profilleri' })).toHaveAttribute('href', '/setup')
  })
})
