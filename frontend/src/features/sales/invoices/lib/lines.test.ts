import {
  emptyInvoice,
  emptyInvoiceLine,
  estimateTotals,
  invoiceFieldMapper,
  invoiceLineProblems,
  toInvoiceInput,
  toPreviewInput,
  previewLineFor,
  previewRowIndexes,
  undeliveredGoods,
  valuesFromInvoice,
  type InvoiceLineValues,
  type InvoiceValues,
} from './lines'
import { wireHeader, wireLine } from '../kit/fixtures'
import type { InvoiceSummary } from '../types'

const invoiceDefaults: Omit<InvoiceSummary, keyof ReturnType<typeof wireHeader>> & {
  status: 'draft'
} = {
  status: 'draft',
  invoice_type: 'sale',
  order_id: null,
  delivery_id: null,
  return_id: null,
  original_invoice_id: null,
  deliver_on_invoice: false,
  journal_entry_id: null,
  reversal_journal_entry_id: null,
  paid_amount: '0',
  balance_due: '0',
  issued_at: null,
  issued_by: null,
  reversed_at: null,
  reversal_date: null,
  reversal_reason: null,
  credit_override_reason: null,
  e_document_status: null,
  e_document_uuid: null,
}

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
  it('keeps a stored exchange rate verbatim, including an explicit 1', () => {
    const stored = { ...values([filled()]), currencyCode: 'EUR', fxRate: '', fxAuto: true }
    expect(toInvoiceInput(stored).fx_rate).toBeNull()
    const explicit = toInvoiceInput(
      valuesFromInvoice({
        ...wireHeader({ currency_code: 'EUR', fx_rate: '1' }),
        ...invoiceDefaults,
        links: [],
        lines: [],
      }),
    )
    expect(explicit.fx_rate).toBe('1')
  })

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

  it('maps preview answers back to the same rows the request was built from', () => {
    // Row 0 is filled in but has no unit yet, so it is not priced; row 1 is.
    const v = values([filled({ unitId: '' }), filled({ quantity: '3' })])
    expect(previewRowIndexes(v)).toEqual([1])
    expect(toPreviewInput(v)?.lines.map((l) => l.quantity)).toEqual(['3'])
    const preview = { lines: [{ line_total: 'row1' }] }
    expect(previewLineFor(v, preview, 0)).toBeUndefined()
    expect(previewLineFor(v, preview, 1)).toEqual({ line_total: 'row1' })
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

  it('sends the order line of a copied line and needs an item only on direct lines', () => {
    const inv = valuesFromInvoice({
      ...wireHeader(),
      ...invoiceDefaults,
      links: [],
      lines: [
        {
          ...wireLine({ id: 'il1' }),
          order_line_id: 'ol1',
          delivery_line_id: null,
          original_line_id: null,
        },
      ],
    })
    expect(inv.lines[0]?.sourceLineId).toBe('ol1')
    const input = toInvoiceInput(inv)
    expect(input.lines[0]).toMatchObject({ order_line_id: 'ol1', delivery_line_id: null })
    expect(input).not.toHaveProperty('invoice_type')
    // A description-only direct line is refused by the API (item_id required): flag it.
    const textOnly = filled({ itemId: '', description: 'Nakliye' })
    expect(invoiceLineProblems(textOnly, m).map(([f]) => f)).toContain('itemId')
    expect(
      invoiceLineProblems({ ...textOnly, deliveryLineId: 'dl1' }, m).map(([f]) => f),
    ).not.toContain('itemId')
    // preview-totals needs an item on every line: such rows are not priced.
    expect(previewRowIndexes(values([textOnly, filled()]))).toEqual([1])
  })

  it('counts stock lines without a delivery (deliver_on_invoice needed)', () => {
    expect(
      undeliveredGoods(
        values([filled(), filled({ deliveryLineId: 'dl1' }), filled({ itemType: 'service' })]),
      ),
    ).toBe(1)
  })
})
