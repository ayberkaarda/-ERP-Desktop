import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import type { DeviceDto } from '../../bridge/generated/DeviceDto'
import { harness, renderApp, renderGate, useTurkish } from './testing'

beforeEach(useTurkish)

const FILE = 'C:/Users/ada/AppData/Roaming/com.keystone.desktop/profiles.json'

describe('unreadable profiles file', () => {
  it('names the file the shell could not read and keeps it untouched', async () => {
    renderGate(
      harness({
        profile_state: () => ({
          phase: 'failed',
          error: { code: 'PROFILES_FILE_INVALID', message: 'not valid JSON', path: FILE },
        }),
      }),
    )
    const path = await screen.findByTestId('profiles-file-path')
    expect(path).toHaveTextContent(FILE)
    expect(path.tagName).toBe('CODE')
    expect(screen.getByText(/üzerine yazılmadı/)).toBeInTheDocument()
    expect(screen.queryByText(/Uygulama veri klasöründeki/)).not.toBeInTheDocument()
  })

  it('without a path keeps the general text', async () => {
    renderGate(
      harness({
        profile_state: () => ({ phase: 'failed', error: { code: 'PROFILES_FILE_INVALID', message: 'not valid JSON' } }),
      }),
    )
    expect(await screen.findByText(/Uygulama veri klasöründeki profiles\.json/)).toBeInTheDocument()
    expect(screen.queryByTestId('profiles-file-path')).not.toBeInTheDocument()
    expect(screen.getByText(/üzerine yazılmadı/)).toBeInTheDocument()
  })
})

const DEVICES: DeviceDto[] = [
  {
    id: 'd1',
    name: 'OFIS-PC',
    ip_address: null,
    user_agent: null,
    last_used_at: null,
    expires_at: '2026-12-01T09:00:00Z',
    created_at: null,
    is_current: true,
  },
  {
    id: 'd2',
    name: 'LAPTOP',
    ip_address: null,
    user_agent: null,
    last_used_at: null,
    expires_at: '2026-12-01T09:00:00Z',
    created_at: null,
    is_current: false,
  },
]

describe('this device in the device list', () => {
  it('is marked and cannot be revoked here; the hint says to sign out first', async () => {
    const h = harness({ auth_devices_list: () => DEVICES, auth_devices_revoke: () => null })
    renderApp(h, '/profile/security')
    const current = await screen.findByRole('listitem', { name: 'OFIS-PC' })
    expect(within(current).getByText('Bu cihaz')).toBeInTheDocument()
    expect(within(current).getByRole('button', { name: 'Oturumu kapat' })).toBeDisabled()
    expect(current).toHaveTextContent('Bu cihazın oturumunu kapatmak için önce çıkış yapın.')
    await userEvent.click(within(current).getByRole('button', { name: 'Oturumu kapat' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(h.bridge.callsOf('auth_devices_revoke')).toHaveLength(0)
  })

  it('other devices are not marked and can still be revoked', async () => {
    const h = harness({ auth_devices_list: () => DEVICES, auth_devices_revoke: () => null })
    renderApp(h, '/profile/security')
    const other = await screen.findByRole('listitem', { name: 'LAPTOP' })
    expect(within(other).queryByText('Bu cihaz')).not.toBeInTheDocument()
    expect(other).not.toHaveTextContent('önce çıkış yapın')
    await userEvent.click(within(other).getByRole('button', { name: 'Oturumu kapat' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Oturumu kapat' }))
    await waitFor(() => {
      expect(h.bridge.callsOf('auth_devices_revoke').map((c) => c.args)).toEqual([{ id: 'd2' }])
    })
  })

  it('an answer without is_current marks no device', async () => {
    const old = DEVICES.map((device) => {
      const rest: Partial<DeviceDto> = { ...device }
      delete rest.is_current
      return rest
    })
    renderApp(harness({ auth_devices_list: () => old }), '/profile/security')
    await screen.findByRole('listitem', { name: 'OFIS-PC' })
    expect(screen.queryByText('Bu cihaz')).not.toBeInTheDocument()
    for (const button of screen.getAllByRole('button', { name: 'Oturumu kapat' })) expect(button).toBeEnabled()
  })
})
