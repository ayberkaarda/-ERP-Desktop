import { wireLine } from '../../invoices/kit/fixtures'
import type { OrderSource, OrderSourceLine } from '../types'
import {
  applyAllocations,
  emptyLine,
  exceedsRemaining,
  lineProblems,
  parseSerials,
  serialsElsewhere,
  serverFieldMapper,
  takenByOthers,
  toFromOrderInput,
  valuesFromOrder,
  type DeliveryLineValues,
  type LineMessages,
} from './lines'

const ol = (over: Partial<OrderSourceLine>): OrderSourceLine => ({
  ...wireLine(),
  delivered_quantity: '0',
  invoiced_quantity: '0',
  reservation_id: null,
  ...over,
})

const order: OrderSource = {
  id: 'o1',
  number: 'SO1',
  status: 'confirmed',
  party_id: 'p1',
  party_name: 'Acme',
  warehouse_id: 'wh',
  currency_code: 'TRY',
  lines: [
    ol({ id: 'ol2', line_no: 2, item_id: 'phone', item_tracking: 'serial', quantity: '2' }),
    ol({
      id: 'ol1',
      line_no: 1,
      item_id: 'bolt',
      item_code: 'B',
      item_name: 'Bolt',
      item_tracking: 'lot',
      quantity: '10',
      delivered_quantity: '4',
      unit_code: 'AD',
    }),
    ol({
      id: 'ol3',
      line_no: 3,
      item_id: 'done',
      description: 'Done',
      quantity: '5',
      delivered_quantity: '5',
    }),
    ol({
      id: 'ol4',
      line_no: 4,
      item_id: 'srv',
      item_type: 'service',
      description: 'Service',
      quantity: '1',
    }),
  ],
}

const m: LineMessages = {
  quantity: 'quantity',
  lot: 'lot',
  serialCount: (c, q) => `count ${c}/${q}`,
  serialInteger: 'integer',
  serialDuplicate: (s) => `dup ${s}`,
  overRemaining: 'over',
}

const line = (over: Partial<DeliveryLineValues>): DeliveryLineValues => ({
  ...emptyLine(),
  itemId: 'bolt',
  unitId: 'u',
  quantity: '1',
  ...over,
})

describe('delivery lines', () => {
  it('starts from the order lines that still have something to deliver, in line order', () => {
    const v = valuesFromOrder(order, 'other')
    expect(v.orderId).toBe('o1')
    expect(v.warehouseId).toBe('wh')
    expect(v.lines.map((l) => [l.sourceLineId, l.quantity, l.remaining])).toEqual([
      ['ol1', '6', '6'],
      ['ol2', '2', '2'],
    ])
    expect(v.lines[0]?.itemLabel).toBe('B · Bolt')
  })

  it('sends only lines with a quantity (partial delivery)', () => {
    const v = valuesFromOrder(order, '')
    const [first, second] = v.lines
    if (!first || !second) throw new Error('lines')
    v.lines = [
      { ...first, quantity: '2', lotNo: ' L-A ' },
      { ...second, quantity: '0' },
    ]
    expect(toFromOrderInput(v).lines).toEqual([
      {
        order_line_id: 'ol1',
        quantity: '2',
        lot_no: 'L-A',
        serial_numbers: [],
      },
    ])
  })

  it('maps server line errors past skipped lines', () => {
    const v = valuesFromOrder(order, '')
    const [first, second] = v.lines
    if (!first || !second) throw new Error('lines')
    v.lines = [{ ...first, quantity: '0' }, second]
    const map = serverFieldMapper(v)
    expect(map('lines.0.quantity')).toBe('lines.1.quantity')
    expect(map('lines.0.serial_numbers')).toBe('lines.1.serials')
    expect(map('lines.5.quantity')).toBe('lines')
    expect(map('document_date')).toBe('documentDate')
  })

  it('parses serials from lines, commas and semicolons', () => {
    expect(parseSerials(' A1\nA2, A3;\n\nA4 ')).toEqual(['A1', 'A2', 'A3', 'A4'])
  })

  it('checks lots, serial counts, integers and duplicates across lines', () => {
    expect(lineProblems(line({ tracking: 'lot' }), m, new Set())).toEqual([['lotNo', 'lot']])
    expect(
      lineProblems(line({ tracking: 'serial', quantity: '2', serials: 'S1' }), m, new Set()),
    ).toEqual([['serials', 'count 1/2']])
    expect(
      lineProblems(line({ tracking: 'serial', quantity: '1.5', serials: 'S1' }), m, new Set()),
    ).toEqual([['serials', 'integer']])
    const lines = [
      line({ tracking: 'serial', serials: 'S1' }),
      line({ tracking: 'serial', serials: 'S1' }),
    ]
    expect(lineProblems(lines[1] ?? line({}), m, serialsElsewhere(lines, 1))).toEqual([
      ['serials', 'dup S1'],
    ])
    // A skipped line (quantity 0) is not validated.
    expect(lineProblems(line({ tracking: 'lot', quantity: '0' }), m, new Set())).toEqual([])
  })

  it('flags quantities over the order remaining across split lines', () => {
    const a = line({ sourceLineId: 'ol1', remaining: '6', quantity: '4' })
    const b = line({ sourceLineId: 'ol1', remaining: '6', quantity: '3' })
    expect(exceedsRemaining(a, [a])).toBe(false)
    expect(exceedsRemaining(a, [a, b])).toBe(true)
  })

  it('splits a line over FEFO allocations, keeping a shortage visible', () => {
    const lines = [line({ sourceLineId: 'ol1', quantity: '6' }), line({ itemId: 'x' })]
    const next = applyAllocations(
      lines,
      0,
      [
        { lot_no: 'L-A', expiry_date: null, quantity: '2' },
        { lot_no: 'L-B', expiry_date: null, quantity: '3' },
      ],
      '1',
    )
    expect(next.map((l) => [l.itemId, l.lotNo, l.quantity])).toEqual([
      ['bolt', 'L-A', '2'],
      ['bolt', 'L-B', '3'],
      ['bolt', '', '1'],
      ['x', '', '1'],
    ])
    expect(takenByOthers(next, 2)).toEqual({ 'L-A': '2', 'L-B': '3' })
  })
})
