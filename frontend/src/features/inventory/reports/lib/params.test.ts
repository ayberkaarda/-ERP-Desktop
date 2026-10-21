import { REPORTS, reportBySlug, type ReportDef } from '../definitions'
import { apiParams, initialParams, missingRequired, totalsRow, valueAt } from './params'

function def(slug: string): ReportDef {
  const found = reportBySlug(slug)
  if (!found) throw new Error(`unknown report ${slug}`)
  return found
}

describe('report parameters', () => {
  it('has a unique slug and API path per report', () => {
    expect(new Set(REPORTS.map((r) => r.slug)).size).toBe(REPORTS.length)
    expect(REPORTS.map((r) => r.id)).toEqual([
      'stockStatus',
      'stockLedger',
      'valuation',
      'ageing',
      'expiringLots',
      'abc',
      'turnover',
      'reorder',
    ])
  })

  it('starts with initial values and reports missing required ones', () => {
    const ledger = def('stock-ledger')
    const p = initialParams(ledger)
    expect(p.date_from).toMatch(/^\d{4}-01-01$/)
    expect(missingRequired(ledger, p)).toEqual(['item_id'])
    expect(missingRequired(ledger, { ...p, item_id: 'x' })).toEqual([])
    expect(initialParams(def('abc-analysis'))).toMatchObject({ basis: 'value', a_threshold: '80' })
  })

  it('sends checkboxes as 1/0 and drops empty values', () => {
    expect(apiParams(def('stock-status'), { as_of: '2026-10-21', warehouse_id: '' })).toEqual({
      as_of: '2026-10-21',
      include_zero: '0',
    })
  })

  it('reads nested values and sums total columns unless the API sends totals', () => {
    const ageing = def('ageing')
    const rows = [
      { buckets: { d0_30: { value: '1.10' } }, value: '1.10' },
      { buckets: { d0_30: { value: '2.25' } }, value: '2.25' },
    ]
    expect(valueAt(rows[0], 'buckets.d0_30.value')).toBe('1.10')
    const totals = totalsRow(ageing.columns, rows, { value: '9.99' })
    expect(valueAt(totals, 'buckets.d0_30.value')).toBe('3.35')
    expect(valueAt(totals, 'value')).toBe('9.99')
  })
})
