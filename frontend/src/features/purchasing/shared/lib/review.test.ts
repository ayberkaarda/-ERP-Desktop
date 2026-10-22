import type { OrderLine, PurchaseOrder, PurchaseRfq } from '../types'
import { orderActions } from './lifecycle'
import { orderPreviewInput, orderToInput, orderToValues } from './orderForm'
import { rfqLinesLocked } from './rfqForm'

// Regression tests of the review findings (fe-purch1).

const line = (over: Partial<OrderLine> = {}): OrderLine =>
  ({
    id: 'l1',
    line_no: 1,
    item_id: 'i1',
    variant_id: null,
    item_type: 'stock',
    description: null,
    quantity: '10.000000',
    unit_id: 'u1',
    base_quantity: '10.000000',
    unit_price: '120.000000',
    tax_inclusive: false,
    discount_percent: '0.0000',
    discount_amount: '0.0000',
    tax_code_id: 't20',
    withholding_code_id: null,
    warehouse_id: null,
    price_source: 'manual',
    received_quantity: '0.000000',
    invoiced_quantity: '0.000000',
    expected_date: null,
    ...over,
  }) as OrderLine

const order = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
  ({
    id: 'o1',
    status: 'draft',
    document_date: '2026-10-20',
    party_id: 'p1',
    party_name: 'Acme',
    currency_code: 'EUR',
    fx_rate: '1.000000',
    lines: [line()],
    links: [],
    audit: [],
    tax_breakdown: [],
    version: 1,
    ...over,
  }) as PurchaseOrder

describe('review fixes', () => {
  it('locks RFQ lines taken from a request', () => {
    const rfq = (requestLine: string | null) =>
      ({ lines: [{ id: 'q1', request_line_id: requestLine }] }) as unknown as PurchaseRfq
    expect(rfqLinesLocked(rfq('r-l1'))).toBe(true)
    expect(rfqLinesLocked(rfq(null))).toBe(false)
  })

  it('keeps a stored exchange rate of 1 instead of asking for the day rate', () => {
    const v = orderToValues(order())
    expect(v.fxRate).toBe('1')
    expect(orderToInput(v).fx_rate).toBe('1')
    expect(orderToValues(order({ fx_rate: '35.120000' })).fxRate).toBe('35.12')
  })

  it('carries tax_inclusive through the form, the body and the preview', () => {
    const v = orderToValues(order({ lines: [line({ tax_inclusive: true })] }))
    expect(v.lines[0]?.taxInclusive).toBe(true)
    expect(orderToInput(v).lines?.[0]?.tax_inclusive).toBe(true)
    expect(orderPreviewInput(v)?.lines[0]?.tax_inclusive).toBe(true)
    const net = orderToValues(order())
    expect(orderToInput(net).lines?.[0]?.tax_inclusive).toBe(false)
  })

  it('keeps the receipt action while the over-receipt tolerance allows quantity', () => {
    const received = order({
      status: 'received',
      lines: [line({ received_quantity: '10.000000' })],
    })
    expect(orderActions(received, '10')).toContain('createReceipt')
    expect(orderActions(received, '0')).not.toContain('createReceipt')
    // Tolerance not readable: what is left of the order decides.
    expect(orderActions(received, null)).not.toContain('createReceipt')
    const over = order({ status: 'received', lines: [line({ received_quantity: '11.000000' })] })
    expect(orderActions(over, '10')).not.toContain('createReceipt')
  })
})
