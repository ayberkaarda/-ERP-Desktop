import { describe, expect, it, vi } from 'vitest'

import type { StatusDto } from '../bridge/generated/StatusDto'
import { createFakeBridge, deferred, fail, flush } from '../test/fakeBridge'
import { createSyncStore } from './store'

const P1 = 'profile-1'
const P2 = 'profile-2'

function status(overrides: Partial<StatusDto> = {}): StatusDto {
  return {
    state: 'idle',
    error_code: null,
    pending: 0,
    conflicts: 0,
    rejected: 0,
    quarantined: 0,
    failures: 0,
    retry_after: null,
    manifest_mismatch: false,
    ...overrides,
  }
}

function setup(options: { profile?: string | null; initial?: StatusDto } = {}) {
  let active: string | null = options.profile === undefined ? P1 : options.profile
  const bridge = createFakeBridge({
    commands: {
      realtime_status: () => ({ profile_id: active, state: 'connected' }),
      sync_status: () => options.initial ?? status(),
      sync_now: () => undefined,
    },
  })
  const store = createSyncStore(bridge, { now: () => 1_000 })
  return {
    bridge,
    store,
    switchTo: (id: string | null) => {
      active = id
    },
  }
}

describe('sync store', () => {
  it('reads the status and the realtime state first', async () => {
    const { bridge, store } = setup({ initial: status({ pending: 3 }) })
    store.start()
    await flush()
    expect(bridge.callsOf('realtime_status')).toHaveLength(1)
    expect(bridge.callsOf('sync_status')).toHaveLength(1)
    expect(store.getState()).toMatchObject({
      profileId: P1,
      realtime: 'connected',
      status: { pending: 3 },
      statusAt: 1_000,
    })
  })

  it('starts once however often it is asked', async () => {
    const { bridge, store } = setup()
    store.start()
    store.start()
    await flush()
    expect(bridge.callsOf('sync_status')).toHaveLength(1)
    expect(bridge.listeners('engine-event')).toBe(1)
    expect(bridge.listeners('realtime-event')).toBe(1)
  })

  it('has no status without an engine', async () => {
    const { bridge, store } = setup()
    bridge.handle({ sync_status: () => fail('ENGINE_UNAVAILABLE') })
    store.start()
    await flush()
    expect(store.getState().status).toBeNull()
  })

  it('follows status events of the active profile', async () => {
    const { bridge, store } = setup()
    store.start()
    await flush()
    bridge.emitEngine({ type: 'status', profile_id: P1, status: status({ state: 'syncing', conflicts: 2 }) })
    expect(store.getState().status).toMatchObject({ state: 'syncing', conflicts: 2 })
  })

  it('ignores events of another profile', async () => {
    const { bridge, store } = setup()
    store.start()
    await flush()
    bridge.emitEngine({ type: 'status', profile_id: P2, status: status({ state: 'failed' }) })
    bridge.emitRealtime({ type: 'state', profile_id: P2, state: 'unavailable' })
    await flush()
    expect(store.getState().status?.state).toBe('idle')
    expect(store.getState().realtime).toBe('connected')
    // One shared check of the active profile for both events.
    expect(bridge.callsOf('realtime_status')).toHaveLength(2)
  })

  it('takes the event of a profile the user switched to', async () => {
    const { bridge, store, switchTo } = setup()
    store.start()
    await flush()
    switchTo(P2)
    bridge.emitEngine({ type: 'status', profile_id: P2, status: status({ pending: 9 }) })
    await flush()
    expect(store.getState()).toMatchObject({ profileId: P2, status: { pending: 9 } })
  })

  it('a status asked before an event does not overrule it', async () => {
    const { bridge, store } = setup()
    const answer = deferred<StatusDto>()
    bridge.handle({ sync_status: () => answer.promise })
    store.start()
    await flush()
    bridge.emitEngine({ type: 'status', profile_id: P1, status: status({ state: 'offline' }) })
    answer.resolve(status({ state: 'idle' }))
    await flush()
    expect(store.getState().status?.state).toBe('offline')
  })

  it('follows the realtime state of the active profile', async () => {
    const { bridge, store } = setup()
    store.start()
    await flush()
    bridge.emitRealtime({ type: 'state', profile_id: P1, state: 'connecting' })
    expect(store.getState().realtime).toBe('connecting')
  })

  it('passes resource changes of the active profile on', async () => {
    const { bridge, store } = setup()
    const seen: unknown[] = []
    store.onResourcesChanged((change) => seen.push(change))
    store.start()
    await flush()
    bridge.emitEngine({ type: 'resources_changed', profile_id: P1, resources: ['parties'], all: false })
    bridge.emitEngine({ type: 'resources_changed', profile_id: P2, resources: ['items'], all: true })
    await flush()
    expect(seen).toEqual([{ resources: ['parties'], all: false }])
  })

  it('asks for a run with sync_now and lets its failure through', async () => {
    const { bridge, store } = setup()
    store.start()
    await flush()
    await store.syncNow()
    expect(bridge.callsOf('sync_now')).toHaveLength(1)
    bridge.handle({ sync_now: () => fail('ENGINE_UNAVAILABLE') })
    await expect(store.syncNow()).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' })
  })

  it('reads the status again on request', async () => {
    const { bridge, store } = setup()
    store.start()
    await flush()
    bridge.handle({ sync_status: () => status({ pending: 1 }) })
    await store.refreshStatus()
    expect(store.getState().status?.pending).toBe(1)
  })

  it('a refused listen does not escape as an unhandled rejection', async () => {
    const refused = createFakeBridge({ commands: { realtime_status: () => ({ profile_id: P1, state: 'idle' }), sync_status: () => status() } })
    const listen = () => Promise.reject(new Error('no shell'))
    const lonely = createSyncStore({ invoke: refused.invoke, listen }, { now: () => 1 })
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      lonely.start()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(lonely.getState().status?.state).toBe('idle')
      lonely.dispose()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('stops listening when disposed', async () => {
    const { bridge, store } = setup()
    store.start()
    await flush()
    store.dispose()
    await flush()
    expect(bridge.listeners('engine-event')).toBe(0)
    expect(bridge.listeners('realtime-event')).toBe(0)
  })
})
