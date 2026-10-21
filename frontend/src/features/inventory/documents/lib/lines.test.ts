import { formatDecimalDisplay } from '@/lib/money'
import type { ItemRef } from '../types'
import {
  docTotals,
  emptyLine,
  lineProblems,
  parseSerials,
  serialsElsewhere,
  serverFieldMapper,
  toDocInput,
  typeRules,
  type DocValues,
  type LineMessages,
  type LineValues,
} from './lines'
import { baseQuantity, factorOf, lineCost } from './quantity'

const m: LineMessages = {
  item: 'item',
  unit: 'unit',
  quantity: 'quantity',
  quantityPositive: 'positive',
  unitCost: 'cost',
  lot: 'lot',
  expiry: 'expiry',
  serialCount: (count, quantity) => `serials ${count}/${quantity}`,
  serialInteger: 'integer',
  serialDuplicate: (s) => `dup ${s}`,
}

const ref = (over: Partial<ItemRef> = {}): ItemRef => ({
  id: 'i1',
  code: 'STK-1',
  name: 'Bolt',
  base_unit_id: 'pcs',
  base_unit: { id: 'pcs', code: 'ADET', name: 'Adet' },
  tracking: 'none',
  has_expiry: false,
  ...over,
})

const line = (over: Partial<LineValues> = {}): LineValues => ({
  ...emptyLine(),
  itemId: 'i1',
  item: ref(),
  unitId: 'pcs',
  unitCode: 'ADET',
  quantity: '2',
  ...over,
})

describe('stock document lines', () => {
  it('converts quantities to the base unit and rounds line costs', () => {
    expect(baseQuantity('2.5', '24')).toBe('60.000000')
    expect(baseQuantity('abc', '24')).toBeNull()
    expect(factorOf('2.000000', '48.000000')).toBe('24')
    expect(factorOf('0', '0')).toBe('1')
    expect(lineCost('3', '0.333333')?.toFixed()).toBe('1')
    expect(lineCost('1', '0.00494')?.toFixed()).toBe('0.0049')
  })

  it('parses serial numbers from lines, commas and semicolons', () => {
    expect(parseSerials(' SN1\nSN2, SN3;;\n ')).toEqual(['SN1', 'SN2', 'SN3'])
  })

  it('requires a positive quantity and a unit cost on receipts', () => {
    const rules = typeRules('receipt')
    expect(lineProblems(line({ quantity: '0' }), rules, m)).toEqual([
      ['quantity', 'positive'],
      ['unitCost', 'cost'],
    ])
    expect(lineProblems(line({ unitCost: '5' }), rules, m)).toEqual([])
    // Issues are costed by the server.
    expect(lineProblems(line(), typeRules('issue'), m)).toEqual([])
  })

  it('keeps quantities positive; adjustments say in or out per line', () => {
    // The API takes unsigned quantities only (InventoryRequest::QTY).
    expect(lineProblems(line({ quantity: '-3' }), typeRules('issue'), m)).toEqual([
      ['quantity', 'positive'],
    ])
    expect(lineProblems(line({ quantity: '-3' }), typeRules('adjustment'), m)).toEqual([
      ['quantity', 'positive'],
    ])
    expect(lineProblems(line({ quantity: '0' }), typeRules('adjustment'), m)).toEqual([
      ['quantity', 'positive'],
    ])
    const out = toDocInput({
      docType: 'adjustment',
      documentDate: '2026-10-21',
      warehouseId: 'w1',
      targetWarehouseId: '',
      reason: '',
      notes: '',
      allowExpired: true,
      lines: [line({ direction: 'out', unitCost: '4' }), line({ direction: 'in', unitCost: '4' })],
    })
    expect(out.lines.map((l) => [l.direction, l.unit_cost])).toEqual([
      ['out', null],
      ['in', '4'],
    ])
    // Expired lots concern issues and transfers only.
    expect(out).not.toHaveProperty('allow_expired')
  })

  it('asks for lot and expiry on inbound lines of tracked items, not on issues (FEFO)', () => {
    const milk = ref({ tracking: 'lot', has_expiry: true })
    expect(lineProblems(line({ item: milk, unitCost: '1' }), typeRules('receipt'), m)).toEqual([
      ['lotNo', 'lot'],
      ['expiryDate', 'expiry'],
    ])
    expect(lineProblems(line({ item: milk }), typeRules('issue'), m)).toEqual([])
    // An adjustment out takes stock away: no lot needed.
    expect(
      lineProblems(line({ item: milk, direction: 'out' }), typeRules('adjustment'), m),
    ).toEqual([])
    // Items with an expiry date need a lot on the way in even without lot tracking.
    const dated = ref({ has_expiry: true })
    expect(lineProblems(line({ item: dated, unitCost: '1' }), typeRules('receipt'), m)).toEqual([
      ['lotNo', 'lot'],
      ['expiryDate', 'expiry'],
    ])
  })

  it('matches serial numbers to the base quantity and refuses duplicates', () => {
    const phone = ref({ tracking: 'serial' })
    const rules = typeRules('issue')
    expect(lineProblems(line({ item: phone, serials: 'A\nB' }), rules, m)).toEqual([])
    expect(lineProblems(line({ item: phone, serials: 'A' }), rules, m)).toEqual([
      ['serials', 'serials 1/2'],
    ])
    expect(lineProblems(line({ item: phone, quantity: '1.5', serials: 'A' }), rules, m)).toEqual([
      ['quantity', 'integer'],
    ])
    expect(lineProblems(line({ item: phone, serials: 'A\nA' }), rules, m)).toEqual([
      ['serials', 'dup A'],
    ])
    const second = line({ item: phone, serials: 'B\nC' })
    const lines = [line({ item: phone, serials: 'A\nB' }), second]
    expect(lineProblems(second, rules, m, serialsElsewhere(lines, 1))).toEqual([
      ['serials', 'dup B'],
    ])
    // Two cases of 12 need 24 serials.
    const case12 = line({ item: phone, factor: '12', quantity: '2', serials: 'A' })
    expect(lineProblems(case12, rules, m)[0]).toEqual(['serials', 'serials 1/24'])
  })

  it('sums base quantities per unit and rounded costs', () => {
    const lines = [
      line({ quantity: '2', unitCost: '1.005' }),
      line({ quantity: '1', factor: '24', unitId: 'case', unitCode: 'KOLI', unitCost: '20' }),
      emptyLine(),
    ]
    expect(docTotals(lines, typeRules('receipt'))).toEqual({
      lines: 2,
      quantities: [{ unit: 'ADET', quantity: '26' }],
      cost: '22.0100',
    })
    expect(docTotals(lines, typeRules('issue')).cost).toBeNull()
  })

  it('keeps line costs at the money scale and rounds the total only for display', () => {
    const lines = [
      line({ quantity: '1', unitCost: '0.0049' }),
      line({ quantity: '1', unitCost: '0.0049' }),
    ]
    const totals = docTotals(lines, typeRules('receipt'))
    expect(totals.cost).toBe('0.0098')
    expect(formatDecimalDisplay(totals.cost ?? '', { locale: 'tr-TR' })).toBe('0,01')
  })

  it('builds the API body without blank lines and fields the type does not use', () => {
    const values: DocValues = {
      docType: 'transfer',
      documentDate: '2026-10-21',
      warehouseId: 'w1',
      targetWarehouseId: 'w2',
      reason: '  ',
      notes: '',
      allowExpired: false,
      lines: [line({ unitCost: '9', locationId: 'l1', targetLocationId: 'l9' }), emptyLine()],
    }
    expect(toDocInput(values)).toEqual({
      doc_type: 'transfer',
      document_date: '2026-10-21',
      warehouse_id: 'w1',
      target_warehouse_id: 'w2',
      reason: null,
      notes: null,
      allow_expired: false,
      lines: [
        {
          item_id: 'i1',
          unit_id: 'pcs',
          quantity: '2',
          unit_cost: null,
          lot_no: null,
          expiry_date: null,
          serial_numbers: [],
          location_id: 'l1',
          target_location_id: 'l9',
          notes: null,
        },
      ],
    })
    expect(toDocInput({ ...values, docType: 'receipt' }).target_warehouse_id).toBeNull()
  })

  it('maps server field errors to form paths past dropped blank lines', () => {
    const values: DocValues = {
      docType: 'receipt',
      documentDate: '2026-10-21',
      warehouseId: 'w1',
      targetWarehouseId: '',
      reason: '',
      notes: '',
      allowExpired: false,
      lines: [emptyLine(), line(), line()],
    }
    const map = serverFieldMapper(values)
    expect(map('lines.1.unit_cost')).toBe('lines.2.unitCost')
    expect(map('lines.0.serial_numbers.2')).toBe('lines.1.serials')
    expect(map('warehouse_id')).toBe('warehouseId')
    expect(map('lines.7.item_id')).toBe('lines')
  })
})
