import { describe, expect, it, vi } from 'vitest'

import { endSession, loadSession, logout } from '@/features/auth/session'
import type * as WebSession from '@/features/auth/session'
import { appServices } from './defaults'

vi.mock('@/features/auth/session', async (original) => {
  const real = await original<typeof WebSession>()
  return {
    ...real,
    loadSession: vi.fn(() => Promise.resolve(null)),
    endSession: vi.fn(),
    logout: vi.fn(() => Promise.resolve()),
  }
})

describe('web session of the running app', () => {
  it('loads /auth/me fresh', async () => {
    await appServices()?.session.load()
    expect(loadSession).toHaveBeenCalledWith({ fresh: true })
  })

  it('ends and signs out through the web session', async () => {
    const services = appServices()
    services?.session.end()
    expect(endSession).toHaveBeenCalledTimes(1)
    await services?.session.signOut()
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('a path opened from outside the router tells the router', () => {
    const popstate = vi.fn()
    window.addEventListener('popstate', popstate)
    appServices()?.openPath('/sync/outbox')
    window.removeEventListener('popstate', popstate)
    expect(window.location.pathname).toBe('/sync/outbox')
    expect(popstate).toHaveBeenCalledTimes(1)
  })
})
