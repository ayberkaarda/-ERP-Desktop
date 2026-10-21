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

const invLine = (id: string, quantity: string, returned: string, price = '10'): InvoiceLine => ({
  id,
  line_no: 1,
  item_id: 'bolt',
  item_code: 'B',
  item_name: 'Bolt',
  description: null,
  quantity,
  unit_id: 'u',
  unit_price: price,
  discount_percent: '0',
  discount_amount: '0',
  net_amount: '0',
  tax_code_id: null,
  tax_rate: '0',
  tax_amount: '0',
  line_total: '0',
  delivery_line_id: null,
  source_line_id: null,
  returned_quantity: returned,
})

describe('return selection', () => {
  it('offers invoiced minus already returned, never negative', () => {
    expect(returnableOf(invLine('a', '10', '3'))).toBe('7')
    expect(returnableOf(invLine('a', '1', '2'))).toBe('0')
    expect(returnableOf({ quantity: '4' })).toBe('4')
  })

  it('validates selected lines only, bounded by the returnable quantity', () => {
    const v = valuesFromInvoice([invLine('a', '10', '3'), invLine('b', '5', '0')], 'wh')
    expect(selectionProblems(v)).toEqual([])
    v.lines = v.lines.map((l, i) =>
      i === 0 ? { ...l, selected: true, quantity: '8' } : { ...l, selected: true, quantity: '0' },
    )
    expect(selectionProblems(v)).toEqual([
      { index: 0, message: 'overReturnable' },
      { index: 1, message: 'quantity' },
    ])
  })

  it('sends the selected lines with their reasons and values them at the invoice price', () => {
    const v = valuesFromInvoice([invLine('a', '10', '3', '12.345'), invLine('b', '5', '0')], 'wh')
    v.lines = v.lines.map((l, i) =>
      i === 0 ? { ...l, selected: true, quantity: '2', reason: ' kırık ' } : l,
    )
    expect(toReturnInput(v).lines).toEqual([
      { invoice_line_id: 'a', quantity: '2', reason: 'kırık', lot_no: null, serial_numbers: [] },
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
