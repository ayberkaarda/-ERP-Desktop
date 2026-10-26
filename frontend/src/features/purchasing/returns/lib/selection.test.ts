import { describe, expect, it } from 'vitest'
import {
  overReturnable,
  rowsFromInvoice,
  rowsFromReceipt,
  selectionValue,
  serialProblem,
  toCreateInput,
  type SelectionRow,
} from './selection'
import type { Invoice } from '../../invoices/types'
import type { Receipt } from '../../receipts/types'

const row = (over: Partial<SelectionRow> = {}): SelectionRow => ({
  sourceLineId: 'l1',
  lineNo: 1,
  itemLabel: 'B Bolt',
  unitCode: 'ADET',
  tracking: 'none',
  returnable: '3',
  sourceQuantity: '4',
  unitNet: '50',
  quantity: '0',
  lotNo: '',
  serialsText: '',
  baseFactor: '1',
  upperBound: false,
  ...over,
})

describe('return selection', () => {
  it('uses server availability including invoice holds even when linked returns are hidden', () => {
    const line = {
      id: 'l1',
      line_no: 1,
      quantity: '10',
      base_quantity: '10',
      net_amount: '100',
      item_tracking: 'none',
      returnable_quantity: '2.000000',
    }
    const receipt = { lines: [line] } as unknown as Receipt
    const invoice = { lines: [line] } as unknown as Invoice
    expect(rowsFromReceipt(receipt, null)[0]).toMatchObject({
      returnable: '2.000000',
      upperBound: false,
    })
    expect(rowsFromInvoice(invoice, new Map([['l1', '1']]))[0]?.returnable).toBe('2.000000')
  })

  it('needs one serial per base unit (1 box = 10 pieces)', () => {
    const box = row({ tracking: 'serial', quantity: '1', baseFactor: '10' })
    expect(serialProblem({ ...box, serialsText: 'A' })).toBe(true)
    const ten = Array.from({ length: 10 }, (_, i) => `S${i}`).join(',')
    expect(serialProblem({ ...box, serialsText: ten })).toBe(false)
  })

  it('offers service lines of an invoice and marks receipt bounds as upper bounds', () => {
    const inv = {
      lines: [
        {
          id: 'a',
          line_no: 1,
          item_type: 'stock',
          quantity: '2',
          base_quantity: '20',
          net_amount: '100',
          item_code: 'B',
          item_name: 'Box',
          description: null,
          unit_code: 'KUTU',
          item_tracking: 'serial',
        },
        {
          id: 'b',
          line_no: 2,
          item_type: 'service',
          quantity: '1',
          base_quantity: '1',
          net_amount: '30',
          item_code: 'S',
          item_name: 'Montaj',
          description: null,
          unit_code: 'ADET',
          item_tracking: 'none',
        },
      ],
    } as unknown as Invoice
    const rows = rowsFromInvoice(inv, new Map())
    expect(rows.map((r) => r.sourceLineId)).toEqual(['a', 'b'])
    expect(rows[0]?.baseFactor).toBe('10')
    expect(rows[0]?.upperBound).toBe(false)
    const rec = {
      lines: [
        {
          id: 'r',
          line_no: 1,
          quantity: '4',
          base_quantity: '4',
          item_code: 'B',
          item_name: 'B',
          description: null,
          unit_code: 'ADET',
          item_tracking: 'lot',
          lot_no: 'L1',
        },
      ],
    } as unknown as Receipt
    expect(rowsFromReceipt(rec, new Map())[0]).toMatchObject({
      upperBound: true,
      returnable: '4',
      lotNo: 'L1',
    })
  })

  it('bounds quantities by what is still returnable', () => {
    expect(overReturnable(row({ quantity: '3' }))).toBe(false)
    expect(overReturnable(row({ quantity: '3.000001' }))).toBe(true)
    // Unknown returnable (too many linked returns): the server decides.
    expect(overReturnable(row({ quantity: '9', returnable: null }))).toBe(false)
  })

  it('needs one serial per returned unit of a serial item', () => {
    expect(serialProblem(row({ tracking: 'serial', quantity: '2', serialsText: 'A\nB' }))).toBe(
      false,
    )
    expect(serialProblem(row({ tracking: 'serial', quantity: '2', serialsText: 'A' }))).toBe(true)
  })

  it('previews the debit value and sends only selected lines with the source key', () => {
    const rows = [row({ quantity: '1.5' }), row({ sourceLineId: 'l2', quantity: '0' })]
    expect(selectionValue(rows)).toBe('75.00')
    const input = toCreateInput('invoice', rows, {
      documentDate: '2026-10-22',
      warehouseId: '',
      reason: ' Hasarlı ',
      notes: '',
    })
    expect(input).toEqual({
      document_date: '2026-10-22',
      warehouse_id: null,
      reason: 'Hasarlı',
      notes: null,
      lines: [{ invoice_line_id: 'l1', quantity: '1.5', lot_no: null, serial_numbers: [] }],
    })
    expect(
      toCreateInput('receipt', [row({ quantity: '1', tracking: 'lot', lotNo: 'L1' })], {
        documentDate: '2026-10-22',
        warehouseId: 'w',
        reason: '',
        notes: '',
      }).lines,
    ).toEqual([{ receipt_line_id: 'l1', quantity: '1', lot_no: 'L1', serial_numbers: [] }])
  })
})
