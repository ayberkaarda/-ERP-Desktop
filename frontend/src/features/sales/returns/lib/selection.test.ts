import { wireLine } from '../../invoices/kit/fixtures'
import type { InvoiceLine } from '../../invoices/types'
import {
  cancellable,
  nextAction,
  returnableOf,
  selectionProblems,
  selectionValue,
  toReturnInput,
  valuesFromInvoice,
} from './selection'

const invLine = (id: string, quantity: string, price = '10'): InvoiceLine => ({
  ...wireLine({ id, quantity, unit_price: price }),
  item_code: 'B',
  item_name: 'Bolt',
  order_line_id: null,
  delivery_line_id: null,
  original_line_id: null,
})

describe('return selection', () => {
  it('values returned quantities at the discounted net amount of the invoice line', () => {
    // 1 unit at 100 with 20% discount: net 80, so returning it is worth 80, not 100.
    const line = { ...invLine('a', '1', '100'), discount_percent: '20', net_amount: '80.0000' }
    const v = valuesFromInvoice([line, { ...invLine('b', '3', '10'), net_amount: '25.0000' }], 'wh')
    v.lines = v.lines.map((l) => ({
      ...l,
      selected: true,
      quantity: l.invoiceLineId === 'a' ? '1' : '1',
    }))
    // 80 + 25 / 3 = 80 + 8.33
    expect(selectionValue(v)).toBe('88.33')
  })

  it('offers invoiced minus already returned, never negative', () => {
    expect(returnableOf(invLine('a', '10'), '3')).toBe('7')
    expect(returnableOf(invLine('a', '1'), '2')).toBe('0')
    expect(returnableOf({ quantity: '4' })).toBe('4')
  })

  it('validates selected lines only, bounded by the returnable quantity', () => {
    // 3 of line a are already on another return of the invoice.
    const v = valuesFromInvoice([invLine('a', '10'), invLine('b', '5')], 'wh', { a: '3' })
    expect(v.lines.map((l) => l.returnable)).toEqual(['7', '5'])
    expect(selectionProblems(v)).toEqual([])
    v.lines = v.lines.map((l, i) =>
      i === 0 ? { ...l, selected: true, quantity: '8' } : { ...l, selected: true, quantity: '0' },
    )
    expect(selectionProblems(v)).toEqual([
      { index: 0, message: 'overReturnable' },
      { index: 1, message: 'quantity' },
    ])
  })

  it('sends the selected lines (no per-line reason on the API) and values them at the invoice net', () => {
    const v = valuesFromInvoice(
      [{ ...invLine('a', '10', '12.345'), net_amount: '123.4500' }, invLine('b', '5')],
      'wh',
      { a: '3' },
    )
    v.lines = v.lines.map((l, i) => (i === 0 ? { ...l, selected: true, quantity: '2' } : l))
    expect(toReturnInput(v).lines).toEqual([
      { invoice_line_id: 'a', quantity: '2', lot_no: null, serial_numbers: [] },
    ])
    expect(selectionValue(v)).toBe('24.69')
  })

  it('walks draft -> approved -> received -> credited', () => {
    expect(nextAction('draft')).toBe('approve')
    expect(nextAction('approved')).toBe('receive')
    expect(nextAction('received')).toBe('credit')
    expect(nextAction('credited')).toBeNull()
    expect(cancellable('approved')).toBe(true)
    expect(cancellable('received')).toBe(false)
  })
})
