import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { harness, renderApp, useTurkish } from './testing'

beforeEach(useTurkish)

describe('DesktopSecurityExtras: device list', () => {
  const DEVICE = {
    id: 'd1',
    name: 'OFIS-PC',
    ip_address: null,
    user_agent: null,
    last_used_at: '2026-11-01T09:00:00Z',
    expires_at: '2026-12-01T09:00:00Z',
    created_at: null,
  }

  it('shows when a device was last used', async () => {
    renderApp(harness({ auth_devices_list: () => [DEVICE] }), '/profile/security')
    expect(await screen.findByRole('listitem', { name: 'OFIS-PC' })).toHaveTextContent(/Son kullanım: .*2026/)
  })

  it('reads the device list once, not on every render', async () => {
    const h = harness({ auth_devices_list: () => [DEVICE] })
    renderApp(h, '/profile/security')
    await screen.findByRole('listitem', { name: 'OFIS-PC' })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(h.bridge.callsOf('auth_devices_list')).toHaveLength(1)
  })
})
