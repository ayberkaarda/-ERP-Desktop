import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import type { DeviceDto } from '../../bridge/generated/DeviceDto'
import { fail } from '../../test/fakeBridge'
import { harness, renderApp, useTurkish } from './testing'

beforeEach(useTurkish)

const device = (id: string, name: string, current: boolean): DeviceDto => ({
  id,
  name,
  ip_address: null,
  user_agent: null,
  last_used_at: null,
  expires_at: '2026-12-01T09:00:00Z',
  created_at: null,
  is_current: current,
})

describe('DesktopSecurityExtras: revoking devices', () => {
  it('protects every device the server marks current', async () => {
    renderApp(
      harness({ auth_devices_list: () => [device('d1', 'A-PC', true), device('d2', 'B-PC', true), device('d3', 'C-PC', false)] }),
      '/profile/security',
    )
    for (const name of ['A-PC', 'B-PC']) {
      const item = await screen.findByRole('listitem', { name })
      expect(within(item).getByRole('button', { name: 'Oturumu kapat' })).toBeDisabled()
    }
    expect(within(screen.getByRole('listitem', { name: 'C-PC' })).getByRole('button', { name: 'Oturumu kapat' })).toBeEnabled()
  })

  it('names the device in the confirmation and does nothing on cancel', async () => {
    const h = harness({ auth_devices_list: () => [device('d1', 'OFIS-PC', true), device('d2', 'LAPTOP', false)], auth_devices_revoke: () => null })
    renderApp(h, '/profile/security')
    const laptop = await screen.findByRole('listitem', { name: 'LAPTOP' })
    await userEvent.click(within(laptop).getByRole('button', { name: 'Oturumu kapat' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('LAPTOP cihazındaki giriş sona erer.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(h.bridge.callsOf('auth_devices_revoke')).toHaveLength(0)
  })

  it('says the device was signed out after a successful revoke', async () => {
    const h = harness({ auth_devices_list: () => [device('d2', 'LAPTOP', false)], auth_devices_revoke: () => null })
    renderApp(h, '/profile/security')
    const laptop = await screen.findByRole('listitem', { name: 'LAPTOP' })
    await userEvent.click(within(laptop).getByRole('button', { name: 'Oturumu kapat' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Oturumu kapat' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Cihaz oturumu kapatıldı.')
  })

  it('shows a failed revoke by its translated code and does not say it was done', async () => {
    const h = harness({ auth_devices_list: () => [device('d2', 'LAPTOP', false)], auth_devices_revoke: () => fail('NETWORK_ERROR') })
    renderApp(h, '/profile/security')
    const laptop = await screen.findByRole('listitem', { name: 'LAPTOP' })
    await userEvent.click(within(laptop).getByRole('button', { name: 'Oturumu kapat' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Oturumu kapat' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucuya ulaşılamadı.')
    expect(screen.queryByText('Cihaz oturumu kapatıldı.')).not.toBeInTheDocument()
  })

  it('reads the list exactly once in 500 ms with a current device on screen', async () => {
    const h = harness({ auth_devices_list: () => [device('d1', 'OFIS-PC', true), device('d2', 'LAPTOP', false)] })
    renderApp(h, '/profile/security')
    await screen.findByText('Bu cihaz')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(h.bridge.callsOf('auth_devices_list')).toHaveLength(1)
  })
})

