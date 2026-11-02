import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/providers'
import type * as WebPlatform from '@/platform'
import type { FakeBridge } from '../../test/fakeBridge'

// The shell window is present, but the app platform is a web-kind one: the
// gate must leave the web app alone and ask the shell nothing.
const shell = vi.hoisted(() => ({ fake: null as FakeBridge | null }))

function fake(): FakeBridge {
  if (!shell.fake) throw new Error('fake bridge not built yet')
  return shell.fake
}

vi.mock('@tauri-apps/api/core', async () => {
  const { createFakeBridge } = await import('../../test/fakeBridge')
  shell.fake = createFakeBridge({ commands: {} })
  return { invoke: (command: string, args?: Record<string, unknown>) => fake().invoke(command, args) }
})
vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (event: { payload: unknown }) => void) => fake().listen(event, handler),
}))
vi.mock('@/platform', async (original) => {
  const real = await original<typeof WebPlatform>()
  return { ...real, platform: { ...real.platform, kind: 'web' } }
})

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

describe('gate on a web-kind platform', () => {
  it('has no services and renders the web app untouched, even in the shell window', async () => {
    const { appServices } = await import('./defaults')
    const { AppGate } = await import('./AppGate')
    const { platform } = await import('@/platform')
    expect(platform.kind).toBe('web')
    expect(appServices()).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const before = shell.fake?.calls.length
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    render(
      <Providers>
        <AppGate>
          <p>web app</p>
        </AppGate>
      </Providers>,
    )
    expect(screen.getByText('web app')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(shell.fake?.callsOf('profile_state')).toEqual([])
    expect(shell.fake?.calls.length).toBe(before)
    expect(shell.fake?.listeners('profile-state')).toBe(0)
    expect(screen.queryByTestId('profiles-page')).not.toBeInTheDocument()
  })
})
