import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/providers'
import { platform } from '@/platform'
import { desktopBridgeOf } from '../../platform'
import type { FakeBridge } from '../../test/fakeBridge'
import { AppGate } from './AppGate'
import { appServices, inShell } from './defaults'
import { PROFILE_STATE_EVENT } from './profileState'
import { useTurkish } from './testing'

// The real runtime (platform/runtime.ts) builds the app platform; only the
// Tauri transport underneath it is the fake bridge.
const shell = vi.hoisted(() => ({ fake: null as FakeBridge | null }))

function fake(): FakeBridge {
  if (!shell.fake) throw new Error('fake bridge not built yet')
  return shell.fake
}

vi.mock('@tauri-apps/api/core', async () => {
  const { createFakeBridge } = await import('../../test/fakeBridge')
  shell.fake = createFakeBridge({
    commands: {
      profile_list: () => ({ active_id: null, profiles: [] }),
      sync_status: () => Promise.reject(new Error('no profile')),
      realtime_status: () => Promise.reject(new Error('no profile')),
      profile_state: () => ({ phase: 'none' }),
      app_info: () => ({ name: 'K', version: '1', identifier: 'x', sync_schema_version: 1, os: 'windows', debug: true }),
    },
  })
  return { invoke: (command: string, args?: Record<string, unknown>) => fake().invoke(command, args) }
})

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (event: { payload: unknown }) => void) => fake().listen(event, handler),
}))

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

describe('services of the running app', () => {
  it('take the bridge of the app platform and the web session', () => {
    const services = appServices()
    expect(services?.platform).toBe(platform)
    expect(services?.invoke).toBe(desktopBridgeOf(platform)?.invoke)
    expect(services?.listen).toBe(desktopBridgeOf(platform)?.listen)
    expect(services?.session.safeRedirect('//evil.test')).toBe('/')
    expect(services?.session.safeRedirect('/parties')).toBe('/parties')
  })

  it('tell the shell window apart', () => {
    expect(inShell()).toBe(false)
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    expect(inShell()).toBe(true)
  })

  it('in the shell the default gate opens the first-run profile screen over the real platform', async () => {
    await useTurkish()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      Object.assign(window, { __TAURI_INTERNALS__: {} })
      render(
        <Providers>
          <AppGate>
            <p>web app</p>
          </AppGate>
        </Providers>,
      )
      expect(await screen.findByRole('heading', { name: 'Sunucu profilleri' })).toBeInTheDocument()
      expect(screen.getByText('Başlamak için bir sunucu adresi ekleyin.')).toBeInTheDocument()
      expect(screen.queryByText('web app')).not.toBeInTheDocument()
      expect(fake().callsOf('profile_state')).toHaveLength(1)
      await waitFor(() => {
        expect(fake().listeners(PROFILE_STATE_EVENT)).toBe(1)
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
