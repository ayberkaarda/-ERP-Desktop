import { describe, expect, it } from 'vitest'

import {
  ENGINE_EVENT,
  listenEngine,
  parseEngineEvent,
  type EngineEvent,
  type Listen,
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
