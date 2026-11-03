import { formatDecimalDisplay } from '@/lib/money'
import de from '@/lib/i18n/locales/inventory-docs/de.json'
import en from '@/lib/i18n/locales/inventory-docs/en.json'
import fr from '@/lib/i18n/locales/inventory-docs/fr.json'
import tr from '@/lib/i18n/locales/inventory-docs/tr.json'
import type { StockDocumentLine } from '../../documents/types'
import {
  changedCounts,
  countedOf,
  countSummary,
  fillBlanks,
  filterLines,
  initialCounts,
  isPendingLine,
  lineVariance,
  varianceValue,
} from './variance'

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
      { line_id: 'a', counted_quantity: '3.000000' },
      { line_id: 'c', counted_quantity: null },
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

  it('values the variance of snapshot lines at the current average cost the server sends', () => {
    const snapshot = line('s', { unit_cost: null, avg_cost: '12.500000' })
    expect(varianceValue(snapshot, '9')?.toFixed()).toBe('-12.5')
    expect(varianceValue(line('n', { unit_cost: null }), '9')?.toFixed()).toBe('0')
  })
})

describe('lines not yet confirmed by the server', () => {
  /** An offline `add` read back before the push: no id, line_no or system quantity. */
  const pending = (code: string, counted: string | null): StockDocumentLine => {
    const l: Partial<StockDocumentLine> = line(code, { counted_quantity: counted })
    delete l.id
    delete l.system_quantity
    return l as StockDocumentLine
  }
  const saved = line('a', { counted_quantity: '4.000000' })
  const counted = pending('p', '3.000000')
  const blank = pending('q', null)
  const lines = [saved, counted, blank]

  it('keeps them out of the editable counts', () => {
    expect(initialCounts(lines)).toEqual({ a: '4.000000' })
    expect(Object.keys(initialCounts(lines))).not.toContain('undefined')
  })

  it('never sends them, even when the editable counts change', () => {
    const counts = { ...initialCounts(lines), a: '5' }
    expect(changedCounts(lines, counts)).toEqual([{ line_id: 'a', counted_quantity: '5' }])
    // A stray value under the old "undefined" key must not produce an id-less entry either.
    expect(changedCounts(lines, { ...counts, undefined: '9' })).toEqual([
      { line_id: 'a', counted_quantity: '5' },
    ])
  })

  it('does not fill them with a system quantity', () => {
    expect(fillBlanks(lines, { a: '' })).toEqual({ a: '10.000000' })
  })

  it('shows their own counted quantity without a variance', () => {
    const counts = initialCounts(lines)
    expect(countedOf(counted, counts)).toBe('3.000000')
    expect(countedOf(blank, counts)).toBe('')
    expect(lineVariance(counted, '3.000000')).toBeNull()
    expect(countSummary(lines, counts)).toEqual({
      total: 3,
      counted: 2,
      differing: 1,
      gain: '0.0000',
      loss: '15.0000',
      net: '-15.0000',
    })
  })

  it('treats an empty id as pending too', () => {
    expect(isPendingLine(line('', {}))).toBe(true)
    expect(isPendingLine(saved)).toBe(false)
  })

  it('hides a counted pending line under "only uncounted" and keeps the blank one', () => {
    const counts = initialCounts(lines)
    expect(filterLines(lines, counts, { q: '', onlyVariance: false, onlyUncounted: true })).toEqual(
      [blank],
    )
  })

  it('has the pending note in every language', () => {
    for (const [lng, m] of Object.entries({ tr, en, de, fr })) {
      expect((m as { count?: { pendingLine?: string } }).count?.pendingLine, lng).toBeTruthy()
    }
  })
})
