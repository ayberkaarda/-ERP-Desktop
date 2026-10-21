import { QueryClient } from '@tanstack/react-query'
import { useCompanyStore } from '@/stores/company'
import { createPayloadKeys } from './idempotency'
import { invalidateSalesEffects, salesDocsKeys } from './keys'
import { linkTo } from './links'
import { money, percent, qty } from './money'
import { saveDraftPermission, SALES_OPEN } from './permissions'
import { scopedViewKey } from './viewKey'

describe('sales kit', () => {
  it('reuses an Idempotency-Key for an identical retry and renews it for a new payload', () => {
    let n = 0
    const keys = createPayloadKeys(() => `k${++n}`)
    expect(keys({ a: 1, b: [1, 2] })).toBe('k1')
    expect(keys({ b: [1, 2], a: 1 })).toBe('k1')
    expect(keys({ a: 2 })).toBe('k2')
    keys.reset()
    expect(keys({ a: 2 })).toBe('k3')
  })

  it('scopes query keys by company and invalidates the neighbours of a posting', async () => {
    useCompanyStore.setState({ activeCompanyId: 'c1' })
    expect(salesDocsKeys.detail('invoices', 'i1')).toEqual([
      'sales',
      'c1',
      'invoices',
      'detail',
      'i1',
    ])
    expect(salesDocsKeys.detail('invoices', 'i1', 'c2')[1]).toBe('c2')
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    invalidateSalesEffects(qc, 'c2')
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(['sales', 'c2', 'orders']))
    expect(keys).toContain(JSON.stringify(['inventory', 'c2']))
    expect(keys).toContain(JSON.stringify(['accounting-journal', 'c2']))
    expect(keys.every((k) => k.includes('"c2"'))).toBe(true)
    await qc.cancelQueries()
  })

  it('keeps saved views per user and company', () => {
    expect(scopedViewKey('sales.invoices', 'u1', 'c1')).toBe('sales.invoices.u1.c1')
    expect(scopedViewKey('sales.invoices', 'u1', null)).toBeNull()
  })

  it('formats decimal strings for reading only', () => {
    expect(money('1234.5', 'tr-TR', 'TRY')).toBe('1.234,50 TRY')
    expect(money('x', 'tr-TR')).toBe('')
    expect(qty('2.500000', 'tr-TR')).toBe('2,5')
    expect(percent('18', 'tr-TR')).toBe('%18')
  })

  it('links chain documents and gates with anyOf', () => {
    expect(linkTo('journal_entry', 'j 1')).toBe('/accounting/journal-entries/j%201')
    expect(SALES_OPEN.customerSummary).toEqual({
      anyOf: ['sales.invoices.view', 'sales.orders.view', 'sales.reports.view'],
    })
    expect(saveDraftPermission('invoices', true)).toBe('sales.invoices.update')
    expect(saveDraftPermission('invoices', false)).toBe('sales.invoices.create')
  })
})
