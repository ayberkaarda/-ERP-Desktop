import { beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { createFakeBridge, fail, flush } from '../../test/fakeBridge'
import { createDesktopPlatform, isDesktopPlatform, PendingWorkError, PlatformCancelledError } from './index'
import type { PlatformDeps } from './u1-shim'

const deps: PlatformDeps = {
  getCompanyId: () => 'c1',
  getLocale: () => 'tr',
  getSessionGeneration: () => 1,
  onAuthFailure: () => undefined,
}

const idle = { state: 'idle', pending: 0, conflicts: 0, rejected: 0, quarantined: 0, failures: 0, manifest_mismatch: false }

async function setup() {
  const profile = { active: 'p1' }
  const bridge = createFakeBridge({
    commands: {
      profile_list: () => ({ active_id: profile.active, profiles: [] }),
      sync_status: () => idle,
      realtime_status: () => ({ profile_id: profile.active, state: 'connected' }),
    },
  })
  const platform = createDesktopPlatform({ deps, invoke: bridge.invoke, listen: bridge.listen })
  await flush()
  return { bridge, platform, profile }
}

describe('createDesktopPlatform', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds the desktop platform with its session and reads the start state', async () => {
    const { platform, bridge } = await setup()
    expect(platform.kind).toBe('desktop')
    expect(isDesktopPlatform(platform)).toBe(true)
    expect(isDesktopPlatform({ ...platform, kind: 'web' })).toBe(false)
    expect(platform.session.passwordChange).toBe('external')
    expect('streamPost' in platform.http).toBe(false)
    expect(bridge.callsOf('profile_list')).toHaveLength(1)
    expect(platform.realtime.state()).toBe('connected')
    expect(platform.connectivity.isOnline()).toBe(true)
    expect(bridge.unhandled).toEqual([])
  })

  it('connects http failures to connectivity', async () => {
    const { platform, bridge } = await setup()
    bridge.handle({ api_request: () => fail('NETWORK_ERROR') })
    await expect(platform.http.get('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(platform.connectivity.isOnline()).toBe(false)
  })

  it('records offline meta in its store and forgets it on a profile switch and a sign-out', async () => {
    const { platform, bridge, profile } = await setup()
    const offline = { partial: false, stale: true }
    bridge.handle({
      api_request: () => ({ status: 200, headers: [], body: { kind: 'json', value: { data: [], meta: { offline } } }, source: 'local' }),
      auth_sign_out: () => ({ status: 'done' }),
    })
    await platform.http.get('/parties')
    expect(platform.desktop.offlineMeta.get('/parties')).toEqual(offline)
    profile.active = 'p2'
    await platform.desktop.refreshProfile()
    expect(platform.desktop.offlineMeta.get('/parties')).toBeUndefined()
    await platform.http.get('/parties')
    await platform.session.logout()
    expect(platform.desktop.offlineMeta.get('/parties')).toBeUndefined()
  })

  it('asks the registered pending-work handler; none registered is a PendingWorkError', async () => {
    const { platform, bridge } = await setup()
    bridge.handle({ auth_sign_out: () => ({ status: 'pending_work', outbox: 1, conflicts: 0 }) })
    await expect(platform.session.logout()).rejects.toBeInstanceOf(PendingWorkError)
    const handler = vi.fn(() => Promise.resolve('keep' as const))
    platform.desktop.setPendingWorkHandler(handler)
    await expect(platform.session.logout()).rejects.toBeInstanceOf(PlatformCancelledError)
    expect(handler).toHaveBeenCalledWith({ action: 'logout', outbox: 1, conflicts: 0 })
    platform.desktop.setPendingWorkHandler(null)
    await expect(platform.session.logout()).rejects.toBeInstanceOf(PendingWorkError)
  })

  it('shows toasts through sonner', async () => {
    const { platform } = await setup()
    platform.notify.success('a', { description: 'd' })
    platform.notify.info('b')
    platform.notify.warning('c')
    platform.notify.error('e')
    expect(toast.success).toHaveBeenCalledWith('a', { description: 'd' })
    expect(toast.info).toHaveBeenCalledWith('b', undefined)
    expect(toast.warning).toHaveBeenCalledWith('c', undefined)
    expect(toast.error).toHaveBeenCalledWith('e', undefined)
  })

  it('dispose stops every event listener', async () => {
    const { platform, bridge } = await setup()
    expect(bridge.listeners('engine-event')).toBe(1)
    expect(bridge.listeners('realtime-event')).toBe(1)
    platform.desktop.dispose()
    await flush()
    expect(bridge.listeners('engine-event') + bridge.listeners('realtime-event')).toBe(0)
  })
})
