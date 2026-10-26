import { describe, expect, it } from 'vitest'
import {
  emptyReceipt,
  emptyReceiptLine,
  parseSerials,
  receiptLineProblems,
  receivedOnForm,
  splitLine,
  toFromOrderInput,
  toReceiptInput,
  valuesFromOrder,
  valuesFromReceipt,
  type ReceiptLineValues,
} from './lines'
import type { OrderSource } from '../types'

const messages = {
  item: 'item',
  unit: 'unit',
  quantity: 'quantity',
  price: 'price',
  lot: 'lot',
  expiry: 'expiry',
  serialCount: 'serialCount',
  serialDuplicate: 'dup',
}

const orderLine = (over: Partial<ReceiptLineValues> = {}): ReceiptLineValues => ({
  ...emptyReceiptLine(),
  orderLineId: 'ol1',
  itemId: 'bolt',
  unitId: 'u',
  quantity: '5',
  remaining: '6',
  ...over,
})

describe('receipt lines', () => {
  it('builds a receipt from the open stock lines of an order', () => {
    const order = {
      id: 'o1',
      number: 'POR1',
      status: 'sent',
      party_id: 'p',
      party_name: 'P',
      warehouse_id: 'w',
      currency_code: 'TRY',
      lines: [
        {
          id: 'a',
          item_id: 'bolt',
          item_type: 'stock',
          quantity: '10.000000',
          received_quantity: '4.000000',
          unit_id: 'u',
          unit_code: 'ADET',
          item_code: 'B',
          item_name: 'Bolt',
          item_tracking: 'lot',
          item_has_expiry: true,
          description: null,
        },
        {
          id: 'b',
          item_id: 'srv',
          item_type: 'service',
          quantity: '1.000000',
          received_quantity: '0.000000',
          unit_id: 'u',
          unit_code: 'ADET',
          item_code: 'S',
          item_name: 'Srv',
          item_tracking: 'none',
          item_has_expiry: false,
          description: null,
        },
        {
          id: 'c',
          item_id: 'nut',
          item_type: 'stock',
          quantity: '3.000000',
          received_quantity: '3.000000',
          unit_id: 'u',
          unit_code: 'ADET',
          item_code: 'N',
          item_name: 'Nut',
          item_tracking: 'none',
          item_has_expiry: false,
          description: null,
        },
      ],
    } as unknown as OrderSource
    const v = valuesFromOrder(order, '2026-10-22')
    expect(v.lines).toHaveLength(1)
    expect(v.lines[0]).toMatchObject({
      orderLineId: 'a',
      quantity: '6',
      remaining: '6',
      tracking: 'lot',
      hasExpiry: true,
    })
    expect(v.warehouseId).toBe('w')
  })

  it('splits a line for another lot and sums split quantities per order line', () => {
    const lines = [orderLine({ lotNo: 'L1', quantity: '4' })]
    const split = splitLine(lines, 0)
    expect(split).toHaveLength(2)
    expect(split[1]).toMatchObject({ orderLineId: 'ol1', quantity: '', lotNo: '' })
    split[1] = { ...split[1], quantity: '2.5' } as ReceiptLineValues
    expect(receivedOnForm(split, 'ol1').toString()).toBe('6.5')
  })

  it('checks lot, expiry and serial count against the quantity', () => {
    expect(receiptLineProblems(orderLine({ tracking: 'lot' }), messages)).toContainEqual([
      'lotNo',
      'lot',
    ])
    expect(receiptLineProblems(orderLine({ hasExpiry: true }), messages)).toContainEqual([
      'expiryDate',
      'expiry',
    ])
    const serial = orderLine({ tracking: 'serial', quantity: '2', serialsText: 'S1\nS2' })
    expect(receiptLineProblems(serial, messages)).toEqual([])
    expect(receiptLineProblems({ ...serial, serialsText: 'S1' }, messages)).toContainEqual([
      'serialsText',
      'serialCount',
    ])
    expect(receiptLineProblems({ ...serial, serialsText: 'S1\nS1' }, messages)).toContainEqual([
      'serialsText',
      'dup',
    ])
    // Zero quantity on an order line means "not received now" and is skipped.
    expect(receiptLineProblems(orderLine({ quantity: '0', tracking: 'lot' }), messages)).toEqual([])
  })

  it('parses scanner input and sends tracking only where the item is tracked', () => {
    expect(parseSerials(' A1 \n\nA2;A3,A4\t')).toEqual(['A1', 'A2', 'A3', 'A4'])
    const values = {
      ...emptyReceipt(),
      orderId: 'o1',
      warehouseId: 'w',
      lines: [
        orderLine({ tracking: 'serial', quantity: '2', serialsText: 'S1\nS2', lotNo: 'ignored' }),
        orderLine({ orderLineId: 'ol2', tracking: 'none', lotNo: 'x', quantity: '0' }),
        orderLine({
          orderLineId: 'ol3',
          tracking: 'lot',
          lotNo: ' L9 ',
          hasExpiry: true,
          expiryDate: '2027-01-01',
        }),
      ],
    }
    const input = toFromOrderInput(values)
    expect(input.lines).toEqual([
      {
        order_line_id: 'ol1',
        quantity: '2',
        lot_no: 'ignored',
        expiry_date: null,
        serial_numbers: ['S1', 'S2'],
        location_id: null,
      },
      {
        order_line_id: 'ol3',
        quantity: '5',
        lot_no: 'L9',
        expiry_date: '2027-01-01',
        serial_numbers: [],
        location_id: null,
      },
    ])
    // Direct receipts carry the supplier and currency; order receipts take them from the order.
    expect(toReceiptInput(values)).not.toHaveProperty('party_id')
    expect(toReceiptInput({ ...values, orderId: '', partyId: 'p' })).toMatchObject({
      party_id: 'p',
      currency_code: 'TRY',
    })
  })
})

describe('receipt line round trip', () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    id: 'l1',
    line_no: 1,
    item_id: 'bolt',
    variant_id: 'v1',
    item_type: 'stock',
    description: 'Özel açıklama',
    quantity: '2.000000',
    unit_id: 'box',
    base_quantity: '20.000000',
    unit_price: '10.000000',
    tax_inclusive: true,
    discount_percent: '5.0000',
    discount_amount: '1.0000',
    tax_code_id: 'vat',
    withholding_code_id: 'wht',
    order_line_id: null,
    lot_no: 'L1',
    expiry_date: null,
    serial_numbers: [],
    location_id: 'loc-1',
    item_code: 'B',
    item_name: 'Bolt',
    unit_code: 'KUTU',
    item_tracking: 'serial',
    item_has_expiry: false,
    ...over,
  })
  const receipt = (lines: unknown[], orderId: string | null = null) =>
    ({
      order_id: orderId,
      party_id: 'p',
      party_name: 'P',
      party_snapshot: { name: 'P' },
      currency_code: 'TRY',
      document_date: '2026-10-22',
      warehouse_id: 'w',
      supplier_reference: null,
      notes: null,
      status: 'draft',
      lines,
    }) as unknown as Parameters<typeof valuesFromReceipt>[0]

  it('keeps fields the editor does not show when a direct receipt is saved again', () => {
    const values = valuesFromReceipt(receipt([stored()]))
    expect(toReceiptInput(values).lines[0]).toEqual({
      item_id: 'bolt',
      variant_id: 'v1',
      unit_id: 'box',
      quantity: '2.000000',
      unit_price: '10.000000',
      tax_code_id: 'vat',
      tax_inclusive: true,
      discount_percent: '5.0000',
      discount_amount: '1.0000',
      withholding_code_id: 'wht',
      description: 'Özel açıklama',
      lot_no: 'L1',
      expiry_date: null,
      serial_numbers: [],
      location_id: 'loc-1',
    })
  })

  it('keeps the location of order receipt lines and counts serials in base units', () => {
    const values = valuesFromReceipt(receipt([stored({ order_line_id: 'ol1' })], 'o1'))
    expect(toReceiptInput(values).lines[0]).toMatchObject({
      order_line_id: 'ol1',
      location_id: 'loc-1',
    })
    const line = values.lines[0]
    if (!line) throw new Error('line')
    expect(line.baseFactor).toBe('10')
    // 2 boxes of 10 pieces: 20 serials, not 2.
    const twenty = Array.from({ length: 20 }, (_, i) => `S${i}`).join('\n')
    expect(receiptLineProblems({ ...line, serialsText: 'S1\nS2' }, messages)).toContainEqual([
      'serialsText',
      'serialCount',
    ])
    expect(receiptLineProblems({ ...line, serialsText: twenty }, messages)).toEqual([])
  })
})
