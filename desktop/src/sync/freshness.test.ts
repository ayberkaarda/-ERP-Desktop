import { describe, expect, it } from 'vitest'

import { createFreshnessTracker, type OfflineMetaSource } from './freshness'
import type { OfflineMeta } from '../platform'

// A source like the P1 store: listeners get the changed path.
function source() {
  const entries = new Map<string, OfflineMeta>()
  const listeners = new Set<(path: string) => void>()
  const value: OfflineMetaSource = {
    get: (path) => entries.get(path),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    value,
    record: (path: string, meta: OfflineMeta | undefined) => {
      if (meta) entries.set(path, meta)
      else entries.delete(path)
      for (const listener of [...listeners]) listener(path)
    },
    listeners: () => listeners.size,
  }
}

const local = (over: Partial<OfflineMeta> = {}): OfflineMeta => ({ partial: false, stale: false, ...over })

describe('freshness tracker', () => {
  it('has nothing to say before a local answer', () => {
    const s = source()
    const tracker = createFreshnessTracker(s.value)
    tracker.start()
    expect(tracker.current()).toBeNull()
  })

  it('names a stale answer', () => {
    const s = source()
    const tracker = createFreshnessTracker(s.value)
    tracker.start()
    s.record('/parties', local({ stale: true }))
    expect(tracker.current()).toEqual({ stale: true, partial: false, asOf: undefined, unsupportedFilters: [] })
  })

  it('names the as-of time, the oldest of several answers', () => {
    const s = source()
    const tracker = createFreshnessTracker(s.value)
    tracker.start()
    s.record('/stock-balances', local({ as_of: '2026-11-02T10:00:00Z' }))
    s.record('/items', local({ as_of: '2026-11-01T08:00:00Z' }))
    expect(tracker.current()?.asOf).toBe('2026-11-01T08:00:00Z')
  })

  it('names a partial local copy', () => {
    const s = source()
    const tracker = createFreshnessTracker(s.value)
    tracker.start()
    s.record('/sales-quotes', local({ partial: true }))
    expect(tracker.current()?.partial).toBe(true)
  })

  it('lists the filters the local copy cannot apply, once each', () => {
    const s = source()
    const tracker = createFreshnessTracker(s.value)
    tracker.start()
    s.record('/parties', local({ unsupported_filters: ['search', 'balance'] }))
    s.record('/items', local({ unsupported_filters: ['balance'] }))
    expect(tracker.current()?.unsupportedFilters).toEqual(['balance', 'search'])
  })

  it('a network answer for the path takes its label away', () => {
    const s = source()
    const tracker = createFreshnessTracker(s.value)
    tracker.start()
    s.record('/parties', local({ stale: true }))
    s.record('/parties', undefined)
    expect(tracker.current()).toBeNull()
  })

  it('a new page starts without the labels of the last one', () => {
    const s = source()
    const tracker = createFreshnessTracker(s.value)
    tracker.start()
    s.record('/parties', local({ stale: true }))
    tracker.reset()
    expect(tracker.current()).toBeNull()
    s.record('/items', local({ partial: true }))
    expect(tracker.current()).toMatchObject({ stale: false, partial: true })
  })

  it('tells its listeners and lets them go', () => {
    const s = source()
    const tracker = createFreshnessTracker(s.value)
    const stopTracker = tracker.start()
    let calls = 0
    const stop = tracker.subscribe(() => {
      calls += 1
    })
    s.record('/parties', local({ stale: true }))
    tracker.reset()
    stop()
    s.record('/items', local())
    expect(calls).toBe(2)
    stopTracker()
    expect(s.listeners()).toBe(0)
  })
})

describe('freshness of several answers', () => {
  it('one stale or partial answer among fresh ones marks the page', () => {
    const s = source()
    const tracker = createFreshnessTracker(s.value)
    tracker.start()
    s.record('/parties', local({ stale: true }))
    s.record('/items', local({ partial: true }))
    s.record('/units', local())
    expect(tracker.current()).toMatchObject({ stale: true, partial: true })
  })

  it('the oldest as_of is compared as time, not as text', () => {
    const s = source()
    const tracker = createFreshnessTracker(s.value)
    tracker.start()
    s.record('/a', local({ as_of: '2026-10-26T10:00:00Z' }))
    s.record('/b', local({ as_of: '2026-10-26T12:00:00+03:00' }))
    expect(tracker.current()?.asOf).toBe('2026-10-26T12:00:00+03:00')
  })
})
