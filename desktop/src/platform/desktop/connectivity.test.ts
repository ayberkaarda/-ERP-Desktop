import { describe, expect, it, vi } from 'vitest'

import type { StatusDto } from '../../bridge/generated/StatusDto'
import { createFakeBridge, deferred, fail, flush } from '../../test/fakeBridge'
import { createDesktopConnectivity } from './connectivity'
import { createActiveProfile } from './profile'

function status(state: string): StatusDto {
  return { state, pending: 0, conflicts: 0, rejected: 0, quarantined: 0, failures: 0, manifest_mismatch: false }
}

async function setup(initial: () => unknown = () => status('idle'), active: string | null = 'p1') {
  const profile = { active }
  const bridge = createFakeBridge({
    commands: {
      profile_list: () => ({ active_id: profile.active, profiles: [] }),
      sync_status: initial,
    },
  })
  const activeProfile = createActiveProfile(bridge.invoke)
  const connectivity = createDesktopConnectivity({ invoke: bridge.invoke, listen: bridge.listen, profile: activeProfile })
  const seen: boolean[] = []
  connectivity.subscribe((online) => seen.push(online))
  await activeProfile.refresh()
  await flush()
  return { bridge, connectivity, seen, profile, activeProfile }
}

describe('desktop connectivity', () => {
  it('starts online and reads the engine state once a profile is known', async () => {
    const s = await setup(() => status('offline'))
    expect(s.bridge.callsOf('sync_status')).toHaveLength(1)
    expect(s.connectivity.isOnline()).toBe(false)
    expect(s.seen).toEqual([false])
  })

  it('stays online when the status cannot be read (no engine)', async () => {
    const s = await setup(() => fail('ENGINE_UNAVAILABLE'))
    expect(s.connectivity.isOnline()).toBe(true)
    expect(s.seen).toEqual([])
  })

  it('reads no status without a profile', async () => {
    const s = await setup(() => status('offline'), null)
    expect(s.bridge.callsOf('sync_status')).toHaveLength(0)
    expect(s.connectivity.isOnline()).toBe(true)
  })

  it('follows engine status events: offline <-> idle, once per change', async () => {
    const s = await setup()
    s.bridge.emitEngine({ type: 'status', profile_id: 'p1', status: status('offline') })
    s.bridge.emitEngine({ type: 'status', profile_id: 'p1', status: status('offline') })
    expect(s.connectivity.isOnline()).toBe(false)
    s.bridge.emitEngine({ type: 'status', profile_id: 'p1', status: status('syncing') })
    expect(s.connectivity.isOnline()).toBe(true)
    s.bridge.emitEngine({ type: 'status', profile_id: 'p1', status: status('offline') })
    s.bridge.emitEngine({ type: 'status', profile_id: 'p1', status: status('idle') })
    expect(s.seen).toEqual([false, true, false, true])
  })

  it('ignores resources_changed and status events of another profile', async () => {
    const s = await setup()
    s.bridge.emitEngine({ type: 'resources_changed', profile_id: 'p1', resources: ['parties'], all: false })
    s.bridge.emitEngine({ type: 'status', profile_id: 'p2', status: status('offline') })
    await flush()
    expect(s.connectivity.isOnline()).toBe(true)
    expect(s.seen).toEqual([])
  })

  it('a NETWORK_ERROR turns it offline until the next network answer', async () => {
    const s = await setup()
    s.connectivity.network.failed()
    expect(s.connectivity.isOnline()).toBe(false)
    s.connectivity.network.failed()
    s.connectivity.network.answered()
    expect(s.connectivity.isOnline()).toBe(true)
    expect(s.seen).toEqual([false, true])
  })

  it('a network answer also ends an engine offline state (the server answered)', async () => {
    const s = await setup()
    s.bridge.emitEngine({ type: 'status', profile_id: 'p1', status: status('offline') })
    s.connectivity.network.answered()
    expect(s.connectivity.isOnline()).toBe(true)
  })

  it('a status answer older than an event does not overwrite it', async () => {
    const answer = deferred<StatusDto>()
    const s = await setup(() => answer.promise)
    s.bridge.emitEngine({ type: 'status', profile_id: 'p1', status: status('offline') })
    answer.resolve(status('idle'))
    await flush()
    expect(s.connectivity.isOnline()).toBe(false)
  })

  it('a status asked before a network answer does not overrule it', async () => {
    const answer = deferred<StatusDto>()
    const s = await setup(() => answer.promise)
    s.connectivity.network.answered()
    answer.resolve(status('offline'))
    await flush()
    expect(s.connectivity.isOnline()).toBe(true)
  })

  it('an unsubscribed listener hears no change', async () => {
    const s = await setup()
    const heard = vi.fn()
    s.connectivity.subscribe(heard)()
    s.connectivity.network.failed()
    expect(s.connectivity.isOnline()).toBe(false)
    expect(heard).not.toHaveBeenCalled()
  })

  it('a profile switch starts over from the new profile status', async () => {
    const s = await setup()
    s.connectivity.network.failed()
    s.profile.active = 'p2'
    s.bridge.handle({ sync_status: () => status('idle') })
    s.bridge.emitEngine({ type: 'status', profile_id: 'p2', status: status('idle') })
    await flush()
    expect(s.activeProfile.current()).toBe('p2')
    expect(s.connectivity.isOnline()).toBe(true)
    expect(s.bridge.callsOf('sync_status')).toHaveLength(2)
  })

  it('follows connectivity events of the active profile, once per change', async () => {
    const s = await setup()
    s.bridge.emitEngine({ type: 'connectivity', profile_id: 'p1', online: false })
    expect(s.connectivity.isOnline()).toBe(false)
    s.bridge.emitEngine({ type: 'connectivity', profile_id: 'p1', online: false })
    s.bridge.emitEngine({ type: 'connectivity', profile_id: 'p1', online: true })
    expect(s.connectivity.isOnline()).toBe(true)
    expect(s.seen).toEqual([false, true])
  })

  it('a reachable server ends a NETWORK_ERROR and an engine offline state', async () => {
    const s = await setup()
    s.connectivity.network.failed()
    s.bridge.emitEngine({ type: 'status', profile_id: 'p1', status: status('offline') })
    s.bridge.emitEngine({ type: 'connectivity', profile_id: 'p1', online: true })
    expect(s.connectivity.isOnline()).toBe(true)
    expect(s.seen).toEqual([false, true])
  })

  it('ignores connectivity events of another profile', async () => {
    const s = await setup()
    s.bridge.emitEngine({ type: 'connectivity', profile_id: 'p2', online: false })
    await flush()
    expect(s.connectivity.isOnline()).toBe(true)
    s.connectivity.network.failed()
    s.bridge.emitEngine({ type: 'connectivity', profile_id: 'p2', online: true })
    await flush()
    expect(s.connectivity.isOnline()).toBe(false)
  })

  it('a connectivity event is newer than a status answer still on its way', async () => {
    const answer = deferred<StatusDto>()
    const s = await setup(() => answer.promise)
    s.bridge.emitEngine({ type: 'connectivity', profile_id: 'p1', online: true })
    answer.resolve(status('offline'))
    await flush()
    expect(s.connectivity.isOnline()).toBe(true)
  })

  it('a sign-out starts over online and reads the engine state again', async () => {
    const s = await setup()
    s.connectivity.network.failed()
    s.bridge.emitEngine({ type: 'status', profile_id: 'p1', status: status('offline') })
    s.bridge.emitEngine({ type: 'connectivity', profile_id: 'p1', online: false })
    expect(s.connectivity.isOnline()).toBe(false)
    s.bridge.handle({ sync_status: () => status('idle') })
    s.connectivity.reset()
    expect(s.connectivity.isOnline()).toBe(true)
    await flush()
    expect(s.connectivity.isOnline()).toBe(true)
    expect(s.bridge.callsOf('sync_status')).toHaveLength(2)
    expect(s.seen).toEqual([false, true])
  })

  it('a sign-out drops a status answer asked before it', async () => {
    const before = deferred<StatusDto>()
    const s = await setup(() => before.promise)
    s.bridge.handle({ sync_status: () => status('idle') })
    s.connectivity.reset()
    before.resolve(status('offline'))
    await flush()
    expect(s.connectivity.isOnline()).toBe(true)
  })

  it('a sign-out still follows the engine state the shell reports afterwards', async () => {
    const s = await setup()
    s.bridge.handle({ sync_status: () => status('offline') })
    s.connectivity.reset()
    await flush()
    expect(s.connectivity.isOnline()).toBe(false)
  })

  it('stops listening on dispose', async () => {
    const s = await setup()
    expect(s.bridge.listeners('engine-event')).toBe(1)
    s.connectivity.dispose()
    await flush()
    expect(s.bridge.listeners('engine-event')).toBe(0)
  })
})
