import Decimal from 'decimal.js'
import { REPORTS, reportBySlug, viewFor, type ColDef } from '../definitions'
import { chartBars, niceScale, stackedSegments } from './chart'
import { apiParams, initialParams, missingRequired, rangeInvalid, totalsRow } from './params'

describe('sales report parameters', () => {
  const def = reportBySlug('sales-by-period')
  if (!def) throw new Error('missing report')

  it('defines the eleven PHASE5 reports under /sales-reports', () => {
    expect(REPORTS.map((r) => r.path)).toEqual([
      '/sales-reports/sales-by-period',
      '/sales-reports/by-customer',
      '/sales-reports/by-item',
      '/sales-reports/by-category',
      '/sales-reports/open-orders',
      '/sales-reports/delivery-vs-invoice',
      '/sales-reports/customer-ageing',
      '/sales-reports/margin',
      '/sales-reports/top-customers',
      '/sales-reports/return-rate',
      '/sales-reports/quote-conversion',
    ])
    expect(new Set(REPORTS.map((r) => r.slug)).size).toBe(REPORTS.length)
  })

  it('fills initial values, requires nothing (the API defaults) and sends only set keys', () => {
    const init = initialParams(def)
    expect(init.period).toBe('month')
    expect(missingRequired(def, {})).toEqual([])
    expect(
      apiParams(def, { date_from: '2026-01-01', date_to: '2026-02-01', party_id: '' }),
    ).toEqual({
      date_from: '2026-01-01',
      date_to: '2026-02-01',
      period: 'month',
    })
    expect(rangeInvalid({ date_from: '2026-03-01', date_to: '2026-02-01' })).toBe(true)
  })

  it('takes totals from meta.totals only', () => {
    const cols: ColDef[] = [
      { key: 'party_name', label: 'partyName', kind: 'text' },
      { key: 'net', label: 'netAmount', kind: 'money', total: true },
      { key: 'rate', label: 'share', kind: 'percent', total: true },
    ]
    expect(totalsRow(cols, { totals: { net: '9.99', rate: '15' } })).toEqual({
      net: '9.99',
      rate: '15',
    })
    expect(totalsRow(cols, {})).toBeNull()
  })

  it('switches columns and chart with group_by and sends group_by only where the API takes it', () => {
    const margin = reportBySlug('margin')
    if (!margin) throw new Error('missing margin')
    expect(viewFor(margin, 'item').columns.map((c) => c.key)).toContain('invoiced_quantity')
    expect(viewFor(margin, 'warehouse').columns.map((c) => c.key)).toEqual([
      'warehouse_label',
      'revenue',
      'cogs',
      'gross_margin',
      'margin_percent',
    ])
    expect(viewFor(margin, 'month').chart).toMatchObject({ kind: 'column', label: 'period' })
    for (const r of REPORTS) {
      const grouped = r.params.some((x) => x.key === 'group_by')
      expect(grouped).toBe(
        [
          'margin',
          'return-rate',
          'quote-conversion',
          'open-orders',
          'delivery-vs-invoice',
          'customer-ageing',
        ].includes(r.slug),
      )
    }
  })
})

describe('sales report charts', () => {
  it('picks a nice axis', () => {
    expect(niceScale(new Decimal(95)).max.toString()).toBe('100')
    expect(niceScale(new Decimal(95)).ticks.map(String)).toEqual(['0', '25', '50', '75', '100'])
    expect(niceScale(new Decimal('0.37')).max.toString()).toBe('0.4')
    expect(niceScale(new Decimal(0)).max.toString()).toBe('1')
  })

  it('sorts and cuts bar charts, keeps column charts in order', () => {
    const rows = [
      { name: 'a', v: '10' },
      { name: 'b', v: '30' },
      { name: 'c', v: '-20' },
      { name: 'd', v: 'n/a' },
    ]
    const bar = chartBars({ kind: 'bar', label: 'name', values: ['v'], top: 2 }, rows)
    expect(bar.bars.map((b) => [b.label, b.ratio])).toEqual([
      ['b', 1],
      ['a', 1 / 3],
    ])
    const col = chartBars({ kind: 'column', label: 'name', values: ['v'] }, rows)
    expect(col.bars.map((b) => b.label)).toEqual(['a', 'b', 'c'])
    expect(col.bars[2]?.negative).toBe(true)
    expect(col.max.toString()).toBe('40')
  })

  it('splits ageing totals into shares', () => {
    const s = stackedSegments(
      { kind: 'stacked', label: 'name', values: ['a', 'b'] },
      { a: '300', b: '100' },
      [],
    )
    expect(s.map((x) => [x.key, x.share])).toEqual([
      ['a', 0.75],
      ['b', 0.25],
    ])
  })
})
