import { beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { createFakeBridge, fail, flush } from '../../test/fakeBridge'
import { createDesktopPlatform, desktopBridgeOf, isDesktopPlatform, PendingWorkError, PlatformCancelledError } from './index'
import type { PlatformDeps } from '@/platform/types'

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

  it('forgets the offline meta on a company switch', async () => {
    const { platform, bridge } = await setup()
    bridge.handle({
      api_request: () => ({ status: 200, headers: [], body: { kind: 'json', value: { data: [], meta: { offline: { partial: false, stale: true } } } }, source: 'local' }),
      profile_select_company: () => ({ company_required: false }),
    })
    await platform.http.get('/parties')
    expect(platform.desktop.offlineMeta.get('/parties')).toBeDefined()
    await platform.session.switchCompany('c2')
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

  it('learns a lost server behind a local fallback answer from the connectivity event', async () => {
    const { platform, bridge } = await setup()
    const local = { status: 200, headers: [], body: { kind: 'json', value: { data: [] } }, source: 'local' }
    bridge.handle({ api_request: () => local })
    await platform.http.get('/parties')
    expect(platform.connectivity.isOnline()).toBe(true)
    bridge.handle({
      api_request: () => {
        bridge.emitEngine({ type: 'connectivity', profile_id: 'p1', online: false })
        return local
      },
    })
    await platform.http.get('/parties')
    expect(platform.connectivity.isOnline()).toBe(false)
  })

  it('a confirmed sign-out resets the connection state; a kept one does not', async () => {
    const { platform, bridge } = await setup()
    bridge.handle({
      api_request: () => fail('NETWORK_ERROR'),
      auth_sign_out: () => ({ status: 'pending_work', outbox: 1, conflicts: 0 }),
    })
    await expect(platform.http.get('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    platform.desktop.setPendingWorkHandler(() => Promise.resolve('keep'))
    await expect(platform.session.logout()).rejects.toBeInstanceOf(PlatformCancelledError)
    expect(platform.connectivity.isOnline()).toBe(false)
    bridge.handle({ auth_sign_out: () => ({ status: 'done' }) })
    await platform.session.logout()
    expect(platform.connectivity.isOnline()).toBe(true)
  })

  it('a company switch keeps the connection state', async () => {
    const { platform, bridge } = await setup()
    bridge.handle({
      api_request: () => fail('NETWORK_ERROR'),
      profile_select_company: () => ({ company_required: false }),
    })
    await expect(platform.http.get('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    await platform.session.switchCompany('c2')
    expect(platform.connectivity.isOnline()).toBe(false)
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

  it('after dispose a profile change reads nothing and keeps the offline meta', async () => {
    const { platform, bridge, profile } = await setup()
    const offline = { partial: false, stale: true }
    bridge.handle({ api_request: () => ({ status: 200, headers: [], body: { kind: 'json', value: { data: [], meta: { offline } } }, source: 'local' }) })
    await platform.http.get('/parties')
    platform.desktop.dispose()
    const before = bridge.calls.length
    profile.active = 'p2'
    await platform.desktop.refreshProfile()
    await flush()
    expect(bridge.calls.slice(before).map((c) => c.command)).toEqual(['profile_list'])
    expect(platform.desktop.offlineMeta.get('/parties')).toEqual(offline)
  })
})

describe('desktop.bridge (the UI command and event surface)', () => {
  it('is one frozen {invoke, listen} object on the platform', async () => {
    const { platform } = await setup()
    const { bridge } = platform.desktop
    expect(Object.keys(bridge).sort()).toEqual(['invoke', 'listen'])
    expect(Object.isFrozen(bridge)).toBe(true)
    expect(platform.desktop.bridge).toBe(bridge)
  })

  it('calls the platform invoke and rejects with a CommandError', async () => {
    const { platform, bridge } = await setup()
    bridge.handle({ outbox_list: () => [{ id: 'o1' }], sync_now: () => fail('NO_ACTIVE_PROFILE') })
    await expect(platform.desktop.bridge.invoke('outbox_list')).resolves.toEqual([{ id: 'o1' }])
    await expect(platform.desktop.bridge.invoke('sync_now')).rejects.toMatchObject({
      name: 'CommandError',
      code: 'NO_ACTIVE_PROFILE',
    })
    expect(bridge.callsOf('outbox_list')).toHaveLength(1)
  })

  it('listens on the platform listen for engine, realtime and profile-state events', async () => {
    const { platform, bridge } = await setup()
    const heard = vi.fn()
    const stops = await Promise.all(
      ['engine-event', 'realtime-event', 'profile-state'].map((name) => platform.desktop.bridge.listen(name, heard)),
    )
    expect(bridge.listeners('profile-state')).toBe(1)
    bridge.emit('profile-state', { phase: 'signed_out' })
    expect(heard).toHaveBeenCalledWith({ payload: { phase: 'signed_out' } })
    for (const stop of stops) stop()
    expect(bridge.listeners('profile-state')).toBe(0)
    // The adaptor's own listeners stay.
    expect(bridge.listeners('engine-event')).toBe(1)
    expect(bridge.listeners('realtime-event')).toBe(1)
  })

  it('desktopBridgeOf returns the desktop bridge and nothing for a web platform', async () => {
    const { platform } = await setup()
    expect(desktopBridgeOf(platform)).toBe(platform.desktop.bridge)
    expect(desktopBridgeOf({ ...platform, kind: 'web' })).toBeUndefined()
  })
})

describe('without a Tauri runtime (listen rejects, as in jsdom)', () => {
  it('leaves no unhandled rejection, and dispose still works', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const fake = createFakeBridge({ commands: { profile_list: () => ({ active_id: null, profiles: [] }) } })
      const listen = vi.fn(() => Promise.reject(new TypeError("Cannot read properties of undefined (reading 'transformCallback')")))
      const platform = createDesktopPlatform({ deps, invoke: fake.invoke, listen })
      await flush()
      await new Promise((resolve) => setTimeout(resolve, 0))
      platform.desktop.dispose()
      await flush()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(listen).toHaveBeenCalledTimes(2)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})

describe('offline meta listeners of the platform', () => {
  it('hear the path a local answer was recorded for', async () => {
    const { platform, bridge } = await setup()
    bridge.handle({
      api_request: () => ({ status: 200, headers: [], body: { kind: 'json', value: { data: [], meta: { offline: { partial: false, stale: true } } } }, source: 'local' }),
    })
    const heard = vi.fn()
    platform.desktop.offlineMeta.subscribe(heard)
    await platform.http.get('/parties', { params: { page: 2 } })
    expect(heard).toHaveBeenCalledWith('/parties')
  })
})
