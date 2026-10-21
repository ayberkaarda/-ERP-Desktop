import { formatDecimalDisplay } from '@/lib/money'
import type { StockDocumentLine } from '../../documents/types'
import { changedCounts, countSummary, filterLines, initialCounts, lineVariance } from './variance'

const line = (id: string, over: Partial<StockDocumentLine> = {}): StockDocumentLine => ({
  id,
  line_no: 1,
  item_id: `item-${id}`,
  item_code: `STK-${id}`,
  item_name: `Item ${id}`,
  unit_id: 'pcs',
  quantity: '0',
  base_quantity: '0',
  unit_cost: '2.500000',
  lot_no: null,
  expiry_date: null,
  serial_numbers: [],
  location_id: null,
  system_quantity: '10.000000',
  counted_quantity: null,
  ...over,
})

describe('count variance', () => {
  const first = line('a')
  const lines = [
    first,
    line('b', { unit_cost: '30.000000', lot_no: 'L-1', counted_quantity: '8.000000' }),
    line('c', { counted_quantity: '10.000000' }),
  ]

  it('values variances at the frozen average cost', () => {
    const counts = { ...initialCounts(lines), a: '12.5' }
    expect(lineVariance(first, '12.5')?.toString()).toBe('2.5')
    expect(lineVariance(first, '')).toBeNull()
    expect(countSummary(lines, counts)).toEqual({
      total: 3,
      counted: 3,
      differing: 2,
      gain: '6.2500',
      loss: '60.0000',
      net: '-53.7500',
    })
  })

  it('sums variance values at the money scale, not per line rounded', () => {
    const tiny = [
      line('x', { system_quantity: '0', unit_cost: '0.004900' }),
      line('y', { system_quantity: '0', unit_cost: '0.004900' }),
    ]
    const summary = countSummary(tiny, { x: '1', y: '1' })
    expect(summary.gain).toBe('0.0098')
    expect(formatDecimalDisplay(summary.gain, { locale: 'tr-TR' })).toBe('0,01')
  })

  it('sends only changed counts, numerically compared', () => {
    const counts = { a: '3.000000', b: '8', c: '' }
    expect(changedCounts(lines, counts)).toEqual([
      { id: 'a', counted_quantity: '3.000000' },
      { id: 'c', counted_quantity: null },
    ])
  })

  it('filters by text, variance and uncounted', () => {
    const counts = initialCounts(lines)
    const ids = (o: Parameters<typeof filterLines>[2]) =>
      filterLines(lines, counts, o).map((l) => l.id)
    expect(ids({ q: 'l-1', onlyVariance: false, onlyUncounted: false })).toEqual(['b'])
    expect(ids({ q: '', onlyVariance: true, onlyUncounted: false })).toEqual(['b'])
    expect(ids({ q: '', onlyVariance: false, onlyUncounted: true })).toEqual(['a'])
  })
})
