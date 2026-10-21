import type { LotStock } from '../types'
import { allocateFefo, fefoOrder, lotAvailable } from './fefo'

const lot = (
  lot_no: string,
  expiry_date: string | null,
  on_hand: string,
  available?: string,
): LotStock => ({ id: lot_no, lot_no, expiry_date, on_hand, available })

const TODAY = '2026-10-21'

describe('FEFO allocation', () => {
  const lots = [
    lot('L-B', '2026-12-01', '3'),
    lot('L-N', null, '50'),
    lot('L-A', '2026-11-15', '2'),
    lot('L-X', '2026-10-20', '9'),
  ]

  it('orders dated lots by expiry, undated last, ties by lot number', () => {
    expect(fefoOrder([...lots, lot('L-A2', '2026-11-15', '1')]).map((l) => l.lot_no)).toEqual([
      'L-X',
      'L-A',
      'L-A2',
      'L-B',
      'L-N',
    ])
  })

  it('takes the first expiring lots and skips expired ones', () => {
    const r = allocateFefo(lots, '6', TODAY)
    expect(r.allocations).toEqual([
      { lot_no: 'L-A', expiry_date: '2026-11-15', quantity: '2' },
      { lot_no: 'L-B', expiry_date: '2026-12-01', quantity: '3' },
      { lot_no: 'L-N', expiry_date: null, quantity: '1' },
    ])
    expect(r.shortage).toBe('0')
    expect(r.skippedExpired).toBe(1)
  })

  it('leaves out what other lines already took and reports a shortage', () => {
    const r = allocateFefo(
      [lot('L-A', '2026-11-15', '2'), lot('L-B', '2026-12-01', '3')],
      '4.5',
      TODAY,
      { 'L-A': '1.5' },
    )
    expect(r.allocations).toEqual([
      { lot_no: 'L-A', expiry_date: '2026-11-15', quantity: '0.5' },
      { lot_no: 'L-B', expiry_date: '2026-12-01', quantity: '3' },
    ])
    expect(r.shortage).toBe('1')
  })

  it('prefers the reported available quantity and never goes negative', () => {
    expect(lotAvailable(lot('L', null, '5', '2')).toString()).toBe('2')
    expect(lotAvailable(lot('L', null, '-1')).toString()).toBe('0')
  })

  it('keeps decimal precision without floats', () => {
    const r = allocateFefo([lot('L-A', null, '0.1'), lot('L-B', null, '0.2')], '0.3', TODAY)
    expect(r.allocations.map((a) => a.quantity)).toEqual(['0.1', '0.2'])
    expect(r.shortage).toBe('0')
  })
})
