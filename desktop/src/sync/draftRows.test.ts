import { describe, expect, it } from 'vitest'

import { createDraftRows, draftRowsOf } from './draftRows'
import type { OfflineMetaSource } from './freshness'
import type { OfflineMeta } from '../platform'

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

const list = (draft_ids?: string[]): OfflineMeta => ({ partial: false, stale: false, pending: true, draft_ids })

describe('draft rows', () => {
  it('names the rows of every local list answer', () => {
    const s = source()
    s.record('/parties', list(['p-1']))
    s.record('/sales-quotes', list(['q-1', 'q-2']))
    s.record('/items', { partial: false, stale: true })
    expect([...createDraftRows(s.value).current()].sort()).toEqual(['p-1', 'q-1', 'q-2'])
  })

  it('a network answer for the path takes its rows away', () => {
    const s = source()
    const rows = createDraftRows(s.value)
    let calls = 0
    const stop = rows.subscribe(() => {
      calls += 1
    })
    s.record('/parties', list(['p-1']))
    expect(rows.current().has('p-1')).toBe(true)
    s.record('/parties', undefined)
    expect(rows.current().size).toBe(0)
    expect(calls).toBe(2)
    stop()
  })

  it('keeps the same set while the ids stay the same', () => {
    const s = source()
    const rows = createDraftRows(s.value)
    const stop = rows.subscribe(() => undefined)
    s.record('/parties', list(['p-1']))
    const first = rows.current()
    let calls = 0
    rows.subscribe(() => {
      calls += 1
    })
    // A later answer of another page, and the same page again.
    s.record('/items', { partial: false, stale: true })
    s.record('/parties', list(['p-1']))
    expect(rows.current()).toBe(first)
    expect(calls).toBe(0)
    stop()
  })

  it('a page answered without drafts names none', () => {
    const s = source()
    s.record('/parties', list(['p-1']))
    s.record('/parties', { partial: false, stale: false })
    expect(createDraftRows(s.value).current().size).toBe(0)
  })

  it('follows the source only while it is listened to', () => {
    const s = source()
    const rows = createDraftRows(s.value)
    const stop = rows.subscribe(() => undefined)
    expect(s.listeners()).toBe(1)
    stop()
    expect(s.listeners()).toBe(0)
    s.record('/parties', list(['p-1']))
    expect(rows.current().has('p-1')).toBe(true)
  })

  it('is shared per source', () => {
    const a = source()
    const b = source()
    expect(draftRowsOf(a.value)).toBe(draftRowsOf(a.value))
    expect(draftRowsOf(a.value)).not.toBe(draftRowsOf(b.value))
  })
})
