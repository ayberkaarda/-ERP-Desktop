import {
  emptyInvoice,
  emptyInvoiceLine,
  estimateTotals,
  invoiceFieldMapper,
  invoiceLineProblems,
  toInvoiceInput,
  toPreviewInput,
  undeliveredGoods,
  type InvoiceLineValues,
  type InvoiceValues,
} from './lines'

const filled = (over: Partial<InvoiceLineValues> = {}): InvoiceLineValues => ({
  ...emptyInvoiceLine(),
  itemId: 'bolt',
  itemType: 'stock',
  unitId: 'u',
  quantity: '2',
  unitPrice: '10',
  taxCodeId: 'kdv20',
  taxRate: '20',
  ...over,
})

const values = (lines: InvoiceLineValues[]): InvoiceValues => ({
  ...emptyInvoice('TRY'),
  partyId: 'p1',
  documentDate: '2026-10-21',
  lines,
})

const m = {
  item: 'item',
  unit: 'unit',
  quantity: 'quantity',
  price: 'price',
  discount: 'discount',
  taxCode: 'tax',
}

describe('invoice form values', () => {
  it('drops blank lines and sends a null price for server resolution', () => {
    const input = toInvoiceInput(
      values([emptyInvoiceLine(), filled({ unitPrice: '' }), filled({ unitPrice: '12.5' })]),
    )
    expect(input.lines).toHaveLength(2)
    expect(input.lines[0]?.unit_price).toBeNull()
    expect(input.lines[1]?.unit_price).toBe('12.5')
    expect(input.fx_rate).toBeNull()
    expect(input.due_date).toBeNull()
  })

  it('builds a preview only once a line has a quantity and unit', () => {
    expect(toPreviewInput(values([emptyInvoiceLine()]))).toBeNull()
    expect(toPreviewInput(values([filled({ unitId: '' })]))).toBeNull()
    expect(toPreviewInput(values([filled()]))?.lines).toHaveLength(1)
  })

  it('estimates totals from typed prices', () => {
    const t = estimateTotals(values([filled(), filled({ quantity: '1', unitPrice: '5.555' })]))
    expect(t.subtotal).toBe('25.56')
    expect(t.tax_total).toBe('5.11')
    expect(t.total).toBe('30.67')
  })

  it('maps server errors among sent lines to form lines and header fields', () => {
    const v = values([emptyInvoiceLine(), filled()])
    const map = invoiceFieldMapper(v)
    expect(map('lines.0.unit_price')).toBe('lines.1.unitPrice')
    expect(map('lines.0.tax_code_id')).toBe('lines.1.taxCodeId')
    expect(map('fx_rate')).toBe('fxRate')
  })

  it('validates quantities, prices, discounts and tax codes', () => {
    expect(invoiceLineProblems(emptyInvoiceLine(), m)).toEqual([])
    expect(
      invoiceLineProblems(
        filled({ quantity: '0', unitPrice: '-1', discountPercent: '101', taxCodeId: '' }),
        m,
      ).map(([f]) => f),
    ).toEqual(['quantity', 'unitPrice', 'discountPercent', 'taxCodeId'])
  })

  it('counts stock lines without a delivery (deliver_on_invoice needed)', () => {
    expect(
      undeliveredGoods(
        values([filled(), filled({ deliveryLineId: 'dl1' }), filled({ itemType: 'service' })]),
      ),
    ).toBe(1)
  })
})
