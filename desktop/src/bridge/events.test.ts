import { describe, expect, it } from 'vitest'

import {
  ENGINE_EVENT,
  REALTIME_EVENT,
  listenEngine,
  listenRealtime,
  parseEngineEvent,
  parseRealtimeEvent,
  type EngineEvent,
  type Listen,
  type RealtimeEventDto,
} from './events'

const status = {
  state: 'idle',
  pending: 0,
  conflicts: 0,
  rejected: 0,
  quarantined: 0,
  failures: 0,
  manifest_mismatch: false,
}

describe('parseEngineEvent', () => {
  it('accepts a status event', () => {
    const payload = { type: 'status', profile_id: 'p1', status }
    expect(parseEngineEvent(payload)).toEqual(payload)
  })

  it('accepts a resources_changed event', () => {
    const payload = {
      type: 'resources_changed',
      profile_id: 'p1',
      resources: ['parties'],
      all: false,
    }
    expect(parseEngineEvent(payload)).toEqual(payload)
  })

  it('refuses malformed payloads', () => {
    expect(parseEngineEvent(null)).toBeUndefined()
    expect(parseEngineEvent('status')).toBeUndefined()
    expect(parseEngineEvent({ type: 'status', status })).toBeUndefined()
    expect(parseEngineEvent({ type: 'status', profile_id: 'p', status: 1 })).toBeUndefined()
    expect(
      parseEngineEvent({ type: 'resources_changed', profile_id: 'p', resources: [1], all: true }),
    ).toBeUndefined()
    expect(
      parseEngineEvent({ type: 'resources_changed', profile_id: 'p', resources: [] }),
    ).toBeUndefined()
    expect(parseEngineEvent({ type: 'other', profile_id: 'p' })).toBeUndefined()
  })
})

describe('listenEngine', () => {
  it('listens to engine-event, delivers valid events and reports the rest', async () => {
    let deliver: ((event: { payload: unknown }) => void) | undefined
    let unlistened = false
    const listen = ((name: string, handler: (event: { payload: unknown }) => void) => {
      expect(name).toBe(ENGINE_EVENT)
      deliver = handler
      return Promise.resolve(() => {
        unlistened = true
      })
    }) as Listen
    const events: EngineEvent[] = []
    const invalid: unknown[] = []
    const unlisten = await listenEngine(
      listen,
      (e) => events.push(e),
      (p) => invalid.push(p),
    )
    deliver?.({ payload: { type: 'status', profile_id: 'p1', status } })
    deliver?.({ payload: { nope: true } })
    expect(events).toHaveLength(1)
    expect(invalid).toEqual([{ nope: true }])
    unlisten()
    expect(unlistened).toBe(true)
  })
})

describe('parseRealtimeEvent', () => {
  const notification = {
    id: 'n1',
    type: 'approval',
    data: { x: 1 },
    read_at: null,
    created_at: '2026-10-27T10:00:00Z',
  }

  it('accepts every documented event', () => {
    for (const payload of [
      { type: 'state', profile_id: 'p1', state: 'disabled' },
      { type: 'state', profile_id: 'p1', state: 'connected' },
      { type: 'session_revoked', profile_id: 'p1', reason: 'deactivated' },
      { type: 'membership_revoked', profile_id: 'p1', company_id: 'c1' },
      { type: 'notification_created', profile_id: 'p1', notification },
    ]) {
      expect(parseRealtimeEvent(payload)).toEqual(payload)
    }
  })

  it('drops what does not have the documented shape', () => {
    for (const payload of [
      null,
      'state',
      { type: 'state', state: 'idle' },
      { type: 'state', profile_id: 'p1', state: 'online' },
      { type: 'session_revoked', profile_id: 'p1' },
      { type: 'membership_revoked', profile_id: 'p1', company_id: 1 },
      { type: 'notification_created', profile_id: 'p1', notification: { id: 'n1' } },
      { type: 'other', profile_id: 'p1' },
    ]) {
      expect(parseRealtimeEvent(payload)).toBeUndefined()
    }
  })
})

describe('listenRealtime', () => {
  it('passes valid events on and reports the others', async () => {
    const handlers: ((event: { payload: unknown }) => void)[] = []
    const names: string[] = []
    const listen: Listen = (name, handler) => {
      names.push(name)
      handlers.push(handler)
      return Promise.resolve(() => undefined)
    }
    const seen: RealtimeEventDto[] = []
    const invalid: unknown[] = []
    await listenRealtime(
      listen,
      (event) => seen.push(event),
      (payload) => invalid.push(payload),
    )

    const event = { type: 'state', profile_id: 'p1', state: 'idle' }
    handlers[0]?.({ payload: event })
    handlers[0]?.({ payload: { type: 'state' } })

    expect(names).toEqual([REALTIME_EVENT])
    expect(seen).toEqual([event])
    expect(invalid).toEqual([{ type: 'state' }])
  })
})
