import { describe, expect, it, vi } from 'vitest'

import type { RealtimeStatusDto } from '../../bridge/generated/RealtimeStatusDto'
import { createFakeBridge, deferred, fail, flush } from '../../test/fakeBridge'
import { createActiveProfile } from './profile'
import { createDesktopRealtime } from './realtime'
import type { RealtimeState, SubscriptionStatus } from '@/platform/types'

const notification = { id: 'n1', type: 'approval.requested', data: { title: 'Onay' }, read_at: null, created_at: '2026-11-01T10:00:00Z' }

async function setup(initial: () => unknown = () => ({ profile_id: 'p1', state: 'connected' })) {
  const bridge = createFakeBridge({
    commands: {
      profile_list: () => ({ active_id: 'p1', profiles: [] }),
      realtime_status: initial,
    },
  })
  const profile = createActiveProfile(bridge.invoke)
  const realtime = createDesktopRealtime({ invoke: bridge.invoke, listen: bridge.listen, profile })
  const states: RealtimeState[] = []
  realtime.subscribe((s) => states.push(s))
  await profile.refresh()
  await flush()
  return { bridge, realtime, states, profile }
}

function listener(realtime: Awaited<ReturnType<typeof setup>>['realtime'], channel: string, event: string) {
  const payloads: unknown[] = []
  const statuses: SubscriptionStatus[] = []
  const stop = realtime.listenPrivate(channel, event, (p) => payloads.push(p), (s) => statuses.push(s))
  return { payloads, statuses, stop }
}

describe('desktop realtime', () => {
  it('connect and disconnect do nothing: the socket lives in the shell', async () => {
    const s = await setup()
    const before = s.bridge.calls.length
    s.realtime.connect()
    s.realtime.disconnect()
    expect(s.bridge.calls.length).toBe(before)
  })

  it('takes the first state from realtime_status, then from state events', async () => {
    const s = await setup(() => ({ profile_id: 'p1', state: 'connecting' }))
    expect(s.realtime.state()).toBe('connecting')
    s.bridge.emitRealtime({ type: 'state', profile_id: 'p1', state: 'connected' })
    s.bridge.emitRealtime({ type: 'state', profile_id: 'p1', state: 'connected' })
    s.bridge.emitRealtime({ type: 'state', profile_id: 'p1', state: 'unavailable' })
    expect(s.states).toEqual(['connecting', 'connected', 'unavailable'])
  })

  it('is idle before the status is known and when it cannot be read', async () => {
    const s = await setup(() => fail('TASK_FAILED'))
    expect(s.realtime.state()).toBe('idle')
  })

  it('ignores a status that names another profile and a status older than an event', async () => {
    const other = await setup(() => ({ profile_id: 'p0', state: 'connected' }))
    expect(other.realtime.state()).toBe('idle')
    const answer = deferred<RealtimeStatusDto>()
    const s = await setup(() => answer.promise)
    s.bridge.emitRealtime({ type: 'state', profile_id: 'p1', state: 'unavailable' })
    answer.resolve({ profile_id: 'p1', state: 'connected' })
    await flush()
    expect(s.realtime.state()).toBe('unavailable')
  })

  it.each([
    ['.session.revoked', { type: 'session_revoked', profile_id: 'p1', reason: 'device_revoked' } as const, { reason: 'device_revoked' }],
    ['.membership.revoked', { type: 'membership_revoked', profile_id: 'p1', company_id: 'c9' } as const, { company_id: 'c9' }],
    ['.notification.created', { type: 'notification_created', profile_id: 'p1', notification } as const, notification],
  ])('maps %s on the user channel', async (event, dto, payload) => {
    const s = await setup()
    const own = listener(s.realtime, 'user.u1', event)
    const others = ['.session.revoked', '.membership.revoked', '.notification.created']
      .filter((e) => e !== event)
      .map((e) => listener(s.realtime, 'user.u1', e))
    s.bridge.emitRealtime(dto)
    expect(own.payloads).toEqual([payload])
    for (const o of others) expect(o.payloads).toEqual([])
  })

  it('drops events of another profile', async () => {
    const s = await setup()
    const own = listener(s.realtime, 'user.u1', '.session.revoked')
    s.bridge.emitRealtime({ type: 'session_revoked', profile_id: 'p0', reason: 'x' })
    s.bridge.emitRealtime({ type: 'state', profile_id: 'p0', state: 'unavailable' })
    await flush()
    expect(own.payloads).toEqual([])
    expect(s.realtime.state()).toBe('connected')
  })

  it('reports subscribed when connected, and again after each reconnect', async () => {
    const s = await setup(() => ({ profile_id: 'p1', state: 'connecting' }))
    const l = listener(s.realtime, 'user.u1', '.notification.created')
    await flush()
    expect(l.statuses).toEqual([])
    s.bridge.emitRealtime({ type: 'state', profile_id: 'p1', state: 'connected' })
    s.bridge.emitRealtime({ type: 'state', profile_id: 'p1', state: 'connecting' })
    s.bridge.emitRealtime({ type: 'state', profile_id: 'p1', state: 'connected' })
    expect(l.statuses).toEqual(['subscribed', 'subscribed'])
  })

  it('reports subscribed right away when already connected', async () => {
    const s = await setup()
    const l = listener(s.realtime, 'user.u1', '.membership.revoked')
    await flush()
    expect(l.statuses).toEqual(['subscribed'])
  })

  it.each([
    ['company.c1', '.session.revoked'],
    ['user.', '.session.revoked'],
    ['user.u1', '.order.created'],
    ['user.u1', 'session.revoked'],
  ])('refuses %s %s loudly with an error status', async (channel, event) => {
    const s = await setup()
    const l = listener(s.realtime, channel, event)
    await flush()
    expect(l.statuses).toEqual(['error'])
    s.bridge.emitRealtime({ type: 'session_revoked', profile_id: 'p1', reason: 'x' })
    expect(l.payloads).toEqual([])
  })

  it('stops a listener', async () => {
    const s = await setup()
    const l = listener(s.realtime, 'user.u1', '.notification.created')
    l.stop()
    await flush()
    s.bridge.emitRealtime({ type: 'notification_created', profile_id: 'p1', notification })
    expect(l.payloads).toEqual([])
    expect(l.statuses).toEqual([])
  })

  it('unsubscribes state listeners and the event on dispose', async () => {
    const s = await setup()
    const extra = vi.fn()
    const stop = s.realtime.subscribe(extra)
    stop()
    s.bridge.emitRealtime({ type: 'state', profile_id: 'p1', state: 'idle' })
    expect(extra).not.toHaveBeenCalled()
    s.realtime.dispose()
    await flush()
    expect(s.bridge.listeners('realtime-event')).toBe(0)
  })

  it('a profile switch resets the state and reads it again', async () => {
    const s = await setup()
    s.bridge.handle({
      profile_list: () => ({ active_id: 'p2', profiles: [] }),
      realtime_status: () => ({ profile_id: 'p2', state: 'connecting' }),
    })
    await s.profile.refresh()
    await flush()
    expect(s.states).toEqual(['connected', 'idle', 'connecting'])
  })
})
