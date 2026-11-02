import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/providers'
import { platform } from '@/platform'
import type { PlatformDeps } from '@/platform/types'
import type { FakeBridge } from '../../test/fakeBridge'
import { AppGate } from './AppGate'
import { inShell, loadAppServices } from './defaults'
import { useTurkish } from './testing'

// The runtime of this file carries a bridge, as the shell's should.
const shell = vi.hoisted(() => ({ fake: null as FakeBridge | null }))

vi.mock('@/platform/runtime', async () => {
  const { createDesktopPlatform } = await import('../../platform')
  const { createFakeBridge: create } = await import('../../test/fakeBridge')
  return {
    createPlatform: (deps: PlatformDeps) => {
      const fake = create({
        commands: {
          profile_list: () => ({ active_id: 'p1', profiles: [] }),
          sync_status: () => Promise.reject(new Error('none')),
          realtime_status: () => Promise.reject(new Error('none')),
          profile_state: () => ({ profile_id: 'p1', phase: 'starting' }),
        },
      })
      shell.fake = fake
      const built = createDesktopPlatform({ deps, invoke: fake.invoke, listen: fake.listen })
      Object.assign(built.desktop, { bridge: { invoke: fake.invoke, listen: fake.listen } })
      return built
    },
  }
})

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

describe('services of the running app', () => {
  it('take the bridge, platform and web session of the shell', async () => {
    const services = await loadAppServices()
    expect(services?.platform).toBe(platform)
    expect(services?.invoke).toBe(shell.fake?.invoke)
    expect(services?.listen).toBe(shell.fake?.listen)
    expect(services?.session.safeRedirect('//evil.test')).toBe('/')
    expect(services?.session.safeRedirect('/parties')).toBe('/parties')
  })

  it('tell the shell window apart', () => {
    expect(inShell()).toBe(false)
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    expect(inShell()).toBe(true)
  })

  it('in the shell the default gate asks the profile state before the web app opens', async () => {
    await useTurkish()
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    render(
      <Providers>
        <AppGate>
          <p>web app</p>
        </AppGate>
      </Providers>,
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Profil açılıyor…')
    await vi.waitFor(() => {
      expect(shell.fake?.callsOf('profile_state')).toHaveLength(1)
    })
    expect(screen.queryByText('web app')).not.toBeInTheDocument()
  })
})
