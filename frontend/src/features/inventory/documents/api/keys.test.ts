import { QueryClient } from '@tanstack/react-query'
import { invalidateStockEffects, invDocsKeys } from './keys'

describe('inventory document query keys', () => {
  it('live under ["inventory", companyId] next to the stock screens', () => {
    expect(invDocsKeys.document('d1', 'c1')).toEqual([
      'inventory',
      'c1',
      'docs',
      'documents',
      'detail',
      'd1',
    ])
    expect(invDocsKeys.stockViews('c1')).toContainEqual([
      'inventory',
      'c1',
      'stock-views',
      'balances',
    ])
  })

  it('marks stock screens, reports and documents of that company stale after posting', () => {
    const client = new QueryClient()
    const seed = (key: readonly unknown[]) => client.setQueryData(key, { seeded: true })
    const stale = [
      ['inventory', 'c1', 'stock-views', 'balances', 'list', {}],
      ['inventory', 'c1', 'stock-views', 'movements', 'list', {}],
      ['inventory', 'c1', 'stock-views', 'lots', 'list', {}],
      ['inventory', 'c1', 'stock-views', 'serials', 'list', {}],
      ['inventory', 'c1', 'docs', 'reports', 'stock-status', { as_of: '2026-10-21' }],
      ['inventory', 'c1', 'docs', 'documents', 'list', {}],
      ['inventory', 'c1', 'docs', 'reservations', 'list', {}],
    ]
    const untouched = [
      ['inventory', 'c2', 'stock-views', 'balances', 'list', {}],
      ['inventory', 'c2', 'docs', 'reports', 'stock-status', {}],
      ['inventory', 'c1', 'stock-views', 'warehouses'],
    ]
    for (const key of [...stale, ...untouched]) seed(key)

    invalidateStockEffects(client, 'c1')

    for (const key of stale) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    for (const key of untouched) expect(client.getQueryState(key)?.isInvalidated).toBe(false)
  })
})
