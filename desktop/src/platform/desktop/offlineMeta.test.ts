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
})
