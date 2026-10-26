import { REPORTS, reportBySlug, visibleColumns, type ReportDef } from '../definitions'
import { apiParams, initialParams, missingRequired, totalsRow } from './params'

function def(slug: string): ReportDef {
  const found = reportBySlug(slug)
  if (!found) throw new Error(`unknown report ${slug}`)
  return found
}

describe('report parameters', () => {
  it('has a unique slug and API path per report, the movement summary included', () => {
    expect(new Set(REPORTS.map((r) => r.slug)).size).toBe(REPORTS.length)
    expect(REPORTS.map((r) => r.path)).toEqual([
      '/inventory-reports/stock-status',
      '/inventory-reports/stock-ledger',
      '/inventory-reports/valuation',
      '/inventory-reports/ageing',
      '/inventory-reports/expiring-lots',
      '/inventory-reports/abc-analysis',
      '/inventory-reports/turnover',
      '/inventory-reports/movement-summary',
      '/reports/reorder-suggestions',
    ])
    // Reorder suggestions are a stock read without an export twin.
    expect(def('reorder-suggestions')).toMatchObject({
      permission: 'inventory.stock.view',
      exportable: false,
      paged: false,
    })
  })

  it('starts with initial values and reports missing required ones', () => {
    const ledger = def('stock-ledger')
    const p = initialParams(ledger)
    expect(p.date_from).toMatch(/^\d{4}-01-01$/)
    expect(missingRequired(ledger, p)).toEqual(['item_id'])
    expect(missingRequired(ledger, { ...p, item_id: 'x' })).toEqual([])
    expect(initialParams(def('abc-analysis'))).toMatchObject({
      basis: 'consumption',
      a: '80',
      b: '95',
    })
  })

  it('sends checkboxes as 1/0, absent ones at their default, and drops empty values', () => {
    expect(
      apiParams(def('stock-status'), {
        as_of: '2026-10-21',
        warehouse_id: '',
        group_by: 'item',
      }),
    ).toEqual({ as_of: '2026-10-21', group_by: 'item', include_zero: '0' })
    // Expired lots are included unless the user unticks it (API default true).
    expect(apiParams(def('expiring-lots'), { days: '10' })).toMatchObject({
      days: '10',
      include_expired: '1',
    })
  })

  it('shows identity columns of the grouping only', () => {
    const status = def('stock-status')
    const keys = (group: string) => visibleColumns(status, group).map((c) => c.key)
    expect(keys('item_warehouse')).toEqual([
      'item_code',
      'item_name',
      'base_unit_id',
      'warehouse_code',
      'quantity',
      'avg_cost',
      'value',
    ])
    expect(keys('category')).toEqual(['category_code', 'category_name', 'item_count', 'value'])
    // Turnover groups per item by default.
    expect(visibleColumns(def('turnover'), undefined).map((c) => c.key)).not.toContain(
      'warehouse_code',
    )
  })

  it('takes totals from meta.totals for the total columns', () => {
    const ageing = def('ageing')
    const totals = totalsRow(ageing.columns, {
      totals: { value: '9.9900', value_0_30: '3.3500', lots: 4 },
    })
    expect(totals).toEqual({ value: '9.9900', value_0_30: '3.3500' })
    expect(totalsRow(ageing.columns, {})).toBeNull()
  })
})
