import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { invalidateChanged } from './invalidation'

const COMPANY = 'c-1'

function client() {
  const qc = new QueryClient()
  const keys = [
    ['parties', COMPANY],
    ['parties', COMPANY, 'detail', 'p-1'],
    ['catalog', COMPANY, 'items'],
    ['sales', COMPANY, 'quotes'],
    ['reference', 'currencies'],
  ]
  for (const key of keys) qc.setQueryData(key, { data: [] })
  const invalid = () =>
    qc
      .getQueryCache()
      .getAll()
      .filter((q) => q.state.isInvalidated)
      .map((q) => JSON.stringify(q.queryKey))
      .sort()
  return { qc, invalid, all: keys.map((k) => JSON.stringify(k)).sort() }
}

describe('invalidateChanged', () => {
  it('a mapped resource invalidates only its own roots', async () => {
    const { qc, invalid } = client()
    await invalidateChanged(qc, { resources: ['parties'], all: false }, COMPANY)
    expect(invalid()).toEqual(
      [JSON.stringify(['parties', COMPANY]), JSON.stringify(['parties', COMPANY, 'detail', 'p-1'])].sort(),
    )
  })

  it('a child resource invalidates its parent roots', async () => {
    const { qc, invalid } = client()
    await invalidateChanged(qc, { resources: ['items.barcodes'], all: false }, COMPANY)
    expect(invalid()).toEqual([JSON.stringify(['catalog', COMPANY, 'items'])])
  })

  it('a resource without a mapping invalidates everything', async () => {
    const { qc, invalid, all } = client()
    await invalidateChanged(qc, { resources: ['sales-quotes', 'not-in-the-manifest'], all: false }, COMPANY)
    expect(invalid()).toEqual(all)
  })

  it('all: true invalidates everything', async () => {
    const { qc, invalid, all } = client()
    await invalidateChanged(qc, { resources: ['parties'], all: true }, COMPANY)
    expect(invalid()).toEqual(all)
  })

  it('without an active company everything is invalidated', async () => {
    const { qc, invalid, all } = client()
    await invalidateChanged(qc, { resources: ['parties'], all: false }, null)
    expect(invalid()).toEqual(all)
  })
})
