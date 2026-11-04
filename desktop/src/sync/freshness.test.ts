import { describe, expect, it } from 'vitest'

import { createFreshnessTracker, type OfflineMetaSource } from './freshness'
import { pageScope, type PageScope } from './pageResources'
import type { OfflineMeta } from '../platform'

// A source like the platform store: listeners get the changed path.
function source() {
  const entries = new Map<string, OfflineMeta>()
  const listeners = new Set<(path: string) => void>()
  const value: OfflineMetaSource = {
    get: (path) => entries.get(path),
    paths: () => [...entries.keys()],
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

/** A page that shows every answer, for the rules that do not depend on the page. */
const EVERYTHING: PageScope = { shows: () => true }

function tracked(page: PageScope = EVERYTHING) {
  const s = source()
  const tracker = createFreshnessTracker(s.value)
  tracker.start()
  tracker.show(page)
  return { s, tracker }
}

describe('freshness tracker', () => {
  it('has nothing to say before a local answer', () => {
    const { tracker } = tracked()
    expect(tracker.current()).toBeNull()
  })

  it('names a stale answer', () => {
    const { s, tracker } = tracked()
    s.record('/parties', local({ stale: true }))
    expect(tracker.current()).toEqual({ stale: true, partial: false, asOf: undefined, unsupportedFilters: [] })
  })

  it('names the as-of time, the oldest of several answers', () => {
    const { s, tracker } = tracked()
    s.record('/stock-balances', local({ as_of: '2026-11-02T10:00:00Z' }))
    s.record('/items', local({ as_of: '2026-11-01T08:00:00Z' }))
    expect(tracker.current()?.asOf).toBe('2026-11-01T08:00:00Z')
  })

  it('names a partial local copy', () => {
    const { s, tracker } = tracked()
    s.record('/sales-quotes', local({ partial: true }))
    expect(tracker.current()?.partial).toBe(true)
  })

  it('lists the filters the local copy cannot apply, once each', () => {
    const { s, tracker } = tracked()
    s.record('/parties', local({ unsupported_filters: ['search', 'balance'] }))
    s.record('/items', local({ unsupported_filters: ['balance'] }))
    expect(tracker.current()?.unsupportedFilters).toEqual(['balance', 'search'])
  })

  it('a network answer for the path takes its label away', () => {
    const { s, tracker } = tracked()
    s.record('/parties', local({ stale: true }))
    s.record('/parties', undefined)
    expect(tracker.current()).toBeNull()
  })

  it('says nothing before it is told the page', () => {
    const s = source()
    const tracker = createFreshnessTracker(s.value)
    tracker.start()
    s.record('/parties', local({ stale: true }))
    expect(tracker.current()).toBeNull()
  })

  it('tells its listeners and lets them go', () => {
    const s = source()
    const tracker = createFreshnessTracker(s.value)
    const stopTracker = tracker.start()
    tracker.show(EVERYTHING)
    let calls = 0
    const stop = tracker.subscribe(() => {
      calls += 1
    })
    s.record('/parties', local({ stale: true }))
    tracker.show(EVERYTHING)
    stop()
    s.record('/items', local())
    expect(calls).toBe(2)
    stopTracker()
    expect(s.listeners()).toBe(0)
  })
})

describe('freshness of the page on screen', () => {
  it('a lookup of another resource does not label the page', () => {
    const { s, tracker } = tracked(pageScope('/sales/quotes'))
    // The party picker and the item names of the lines were answered locally.
    s.record('/parties', local({ stale: true }))
    s.record('/items', local({ partial: true }))
    expect(tracker.current()).toBeNull()
    s.record('/sales-quotes', local({ as_of: '2026-11-02T10:00:00Z' }))
    expect(tracker.current()).toEqual({
      stale: false,
      partial: false,
      asOf: '2026-11-02T10:00:00Z',
      unsupportedFilters: [],
    })
  })

  it('the session read of the header never labels a page', () => {
    const { s, tracker } = tracked(pageScope('/parties'))
    s.record('/auth/me', local({ stale: true }))
    expect(tracker.current()).toBeNull()
  })

  it('a detail page counts its own record, not another one', () => {
    const { s, tracker } = tracked(pageScope('/parties/p-1'))
    s.record('/parties/p-2', local({ stale: true }))
    s.record('/parties', local({ partial: true }))
    expect(tracker.current()).toBeNull()
    s.record('/parties/p-1', local({ stale: true }))
    expect(tracker.current()?.stale).toBe(true)
  })

  it('a detail page counts the child lists of its record', () => {
    const { s, tracker } = tracked(pageScope('/catalog/items/i-1'))
    s.record('/items/i-1/barcodes', local({ partial: true }))
    s.record('/items/i-2/variants', local({ stale: true }))
    expect(tracker.current()).toMatchObject({ partial: true, stale: false })
  })

  it('a new page keeps the label of an answer it shows from the cache', () => {
    const { s, tracker } = tracked(pageScope('/parties'))
    s.record('/parties', local({ stale: true }))
    tracker.show(pageScope('/sales/quotes'))
    expect(tracker.current()).toBeNull()
    // Back on the list before the cached answer is fetched again.
    tracker.show(pageScope('/parties'))
    expect(tracker.current()?.stale).toBe(true)
  })

  it('a page that shows no local copy has no label', () => {
    const { s, tracker } = tracked(pageScope('/'))
    s.record('/parties', local({ stale: true }))
    s.record('/stock-balances', local({ stale: true }))
    expect(tracker.current()).toBeNull()
  })

  it('an answer of another page does not tell the listeners', () => {
    const { s, tracker } = tracked(pageScope('/parties'))
    let calls = 0
    tracker.subscribe(() => {
      calls += 1
    })
    s.record('/items', local({ stale: true }))
    expect(calls).toBe(0)
    s.record('/parties', local({ stale: true }))
    expect(calls).toBe(1)
  })
})

describe('freshness of several answers', () => {
  it('one stale or partial answer among fresh ones marks the page', () => {
    const { s, tracker } = tracked()
    s.record('/parties', local({ stale: true }))
    s.record('/items', local({ partial: true }))
    s.record('/units', local())
    expect(tracker.current()).toMatchObject({ stale: true, partial: true })
  })

  it('the oldest as_of is compared as time, not as text', () => {
    const { s, tracker } = tracked()
    s.record('/a', local({ as_of: '2026-10-26T10:00:00Z' }))
    s.record('/b', local({ as_of: '2026-10-26T12:00:00+03:00' }))
    expect(tracker.current()?.asOf).toBe('2026-10-26T12:00:00+03:00')
  })
})
