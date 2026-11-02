import { describe, expect, it, vi } from 'vitest'

import { createOfflineMetaStore } from './offlineMeta'

describe('offline meta store', () => {
  it('an unsubscribed listener hears no change', () => {
    const store = createOfflineMetaStore()
    const heard = vi.fn()
    store.subscribe(heard)()
    store.record('/a', { partial: false, stale: false })
    expect(store.get('/a')).toEqual({ partial: false, stale: false })
    expect(heard).not.toHaveBeenCalled()
  })

  it('a listener hears the path that was recorded', () => {
    const store = createOfflineMetaStore()
    const heard = vi.fn()
    store.subscribe(heard)
    store.record('/a', { partial: false, stale: false })
    store.record('/b', { partial: true, stale: false })
    expect(heard.mock.calls).toEqual([['/a'], ['/b']])
  })

  it('a listener hears the path that was forgotten, and nothing for an unknown one', () => {
    const store = createOfflineMetaStore()
    store.record('/a', { partial: false, stale: true })
    const heard = vi.fn()
    store.subscribe(heard)
    store.record('/a', undefined)
    store.record('/zzz', undefined)
    expect(heard.mock.calls).toEqual([['/a']])
  })

  it('clear tells every forgotten path once, and an empty clear tells nothing', () => {
    const store = createOfflineMetaStore()
    store.record('/a', { partial: false, stale: true })
    store.record('/b', { partial: false, stale: true })
    const heard = vi.fn()
    store.subscribe(heard)
    store.clear()
    // Each listener reads the store after the whole clear.
    expect(heard.mock.calls.map((c: unknown[]) => c[0]).sort()).toEqual(['/a', '/b'])
    expect(store.get('/a')).toBeUndefined()
    heard.mockClear()
    store.clear()
    expect(heard).not.toHaveBeenCalled()
  })

  it('a clear listener already sees an empty store', () => {
    const store = createOfflineMetaStore()
    store.record('/a', { partial: false, stale: true })
    store.record('/b', { partial: false, stale: true })
    const seen: unknown[] = []
    store.subscribe((path) => seen.push(store.get(path)))
    store.clear()
    expect(seen).toEqual([undefined, undefined])
  })

  it('a listener without a parameter still hears every change', () => {
    const store = createOfflineMetaStore()
    let count = 0
    const stop = store.subscribe(() => {
      count += 1
    })
    store.record('/a', { partial: false, stale: true })
    stop()
    store.record('/b', { partial: false, stale: true })
    expect(count).toBe(1)
  })
})
