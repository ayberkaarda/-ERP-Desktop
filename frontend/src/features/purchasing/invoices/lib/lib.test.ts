import { describe, expect, it } from 'vitest'
import {
  emptyInvoiceLine,
  estimateTotals,
  emptyInvoice,
  priceOverridden,
  toInvoiceInput,
  toPreviewInput,
  valuesFromInvoice,
  toLineInput,
  unreceivedGoods,
  withholdingPercent,
  type InvoiceLineValues,
} from './lines'
import {
  allowedQuantity,
  bookingOutcome,
  isVariance,
  matchCounts,
  parseMatch,
  priceOff,
  quantityExcess,
} from './match'

const raw = {
  mode: 'block',
  status: 'qty_variance',
  override_reason: null,
  lines: [
    {
      invoice_line_id: 'a',
      status: 'qty_variance',
      line_no: 1,
      order_line_id: 'ol1',
      ordered: '10',
      received: '4',
      invoiced: '6',
      reference: '4',
      order_price: '50.000000',
      invoice_price: '55.000000',
      price_difference_percent: '10.0000',
      qty_tolerance_percent: '10',
      price_tolerance_percent: '5',
    },
    { invoice_line_id: 'b', status: 'unmatched', line_no: 2, reason: 'no_order' },
    { invoice_line_id: 'c', status: 'weird', line_no: '3' },
    { status: 'matched' },
  ],
}

describe('three-way match parsing', () => {
  it('reads the breakdown defensively and keeps decimals as strings', () => {
    const m = parseMatch(raw)
    expect(m?.mode).toBe('block')
    expect(m?.status).toBe('qty_variance')
    expect(m?.lines).toHaveLength(3)
    expect(m?.lines[0]?.order_price).toBe('50.000000')
    expect(m?.lines[1]?.reason).toBe('no_order')
    // Unknown statuses count as unmatched; numeric strings become numbers for line_no only.
    expect(m?.lines[2]?.status).toBe('unmatched')
    expect(m?.lines[2]?.line_no).toBe(3)
    expect(parseMatch(null)).toBeNull()
    expect(parseMatch('x')).toBeNull()
  })

  it('computes the allowed quantity with the tolerance and flags price and quantity', () => {
    const l = parseMatch(raw)?.lines[0]
    if (!l) throw new Error('line')
    // 4 × 1.10 = 4.4 allowed; 6 invoiced → 1.6 over.
    expect(allowedQuantity(l)).toBe('4.4')
    expect(quantityExcess(l)).toBe('1.6')
    // 10 % difference against a 5 % tolerance.
    expect(priceOff(l)).toBe(true)
    expect(priceOff({ ...l, price_difference_percent: '5.0000' })).toBe(false)
    expect(quantityExcess({ ...l, invoiced: '4.4' })).toBeNull()
  })

  it('counts statuses and tells what booking will do in each mode', () => {
    const m = parseMatch(raw)
    if (!m) throw new Error('match')
    expect(matchCounts(m)).toEqual({ matched: 0, qty_variance: 1, price_variance: 0, unmatched: 2 })
    expect(bookingOutcome(m)).toBe('block')
    expect(bookingOutcome({ ...m, mode: 'warn' })).toBe('warn')
    expect(bookingOutcome({ ...m, mode: 'off' })).toBe('off')
    expect(bookingOutcome({ ...m, status: 'matched' })).toBe('clean')
    expect(bookingOutcome({ ...m, status: 'unmatched' })).toBe('clean')
    expect(bookingOutcome(null)).toBe('clean')
    expect(isVariance('price_variance')).toBe(true)
  })
})

const sourced = (over: Partial<InvoiceLineValues> = {}): InvoiceLineValues => ({
  ...emptyInvoiceLine(),
  itemId: 'bolt',
  unitId: 'u',
  quantity: '4.000000',
  unitPrice: '50.000000',
  sourcePrice: '50.000000',
  taxRate: '20',
  receiptLineId: 'rl1',
  ...over,
})

describe('invoice lines', () => {
  it('sends sourced lines as source id, quantity and price only', () => {
    expect(toLineInput(sourced())).toEqual({
      receipt_line_id: 'rl1',
      quantity: '4.000000',
      unit_price: '50.000000',
    })
    expect(toLineInput(sourced({ receiptLineId: '', orderLineId: 'ol1' }))).toEqual({
      order_line_id: 'ol1',
      quantity: '4.000000',
      unit_price: '50.000000',
    })
    const direct = toLineInput({ ...sourced({ receiptLineId: '' }), withholdingCodeId: 'w' })
    expect(direct).toMatchObject({ item_id: 'bolt', unit_id: 'u', withholding_code_id: 'w' })
  })

  it('keeps money as decimal strings: 0.1 + 0.2 style sums stay exact, withholding rounded half up', () => {
    const values = {
      ...emptyInvoice(),
      lines: [
        sourced({ quantity: '3', unitPrice: '0.1', withholdingRate: '50' }),
        sourced({ quantity: '1', unitPrice: '0.2', withholdingRate: '50' }),
      ],
    }
    const t = estimateTotals(values)
    expect(t.subtotal).toBe('0.50')
    // VAT per line: 0.06 + 0.04 = 0.10; withholding half of each, rounded per line: 0.03 + 0.02.
    expect(t.tax_total).toBe('0.10')
    expect(t.withholding_total).toBe('0.05')
    expect(t.total).toBe('0.60')
    expect(typeof t.total).toBe('string')
  })

  it('detects price overrides and goods without receipt', () => {
    expect(priceOverridden(sourced())).toBe(false)
    expect(priceOverridden(sourced({ unitPrice: '55' }))).toBe(true)
    // Trailing zeros are not an override.
    expect(priceOverridden(sourced({ unitPrice: '50' }))).toBe(false)
    const values = {
      ...emptyInvoice(),
      lines: [
        sourced({ itemType: 'stock' }),
        sourced({ itemType: 'stock', receiptLineId: '', orderLineId: 'ol' }),
      ],
    }
    expect(unreceivedGoods(values)).toBe(1)
    expect(toInvoiceInput({ ...values, supplierInvoiceNo: '  ' }).supplier_invoice_no).toBeNull()
  })

  it('reads the withheld share of a withholding code', () => {
    expect(withholdingPercent({ numerator: 5, denominator: 10, rate: null })).toBe('50')
    expect(withholdingPercent({ numerator: 2, denominator: 3, rate: null })).toBe('66.6667')
    expect(withholdingPercent({ numerator: null, denominator: null, rate: '30' })).toBe('30')
    expect(withholdingPercent(undefined)).toBe('0')
  })
})

describe('invoice line round trip', () => {
  it('keeps tax_inclusive, variant and line warehouse of stored direct lines and previews them', () => {
    const inv = {
      party_id: 'p',
      party_name: 'P',
      party_snapshot: { name: 'P' },
      supplier_invoice_no: null,
      document_date: '2026-10-22',
      due_date: null,
      currency_code: 'TRY',
      fx_rate: '1',
      payment_term_id: null,
      warehouse_id: null,
      notes: null,
      internal_notes: null,
      receive_on_invoice: false,
      lines: [
        {
          item_id: 'bolt',
          item_code: 'B',
          item_name: 'Bolt',
          item_type: 'stock',
          description: 'x',
          quantity: '1.000000',
          unit_id: 'u',
          unit_price: '120.000000',
          price_source: 'manual',
          discount_percent: '0',
          discount_amount: '0',
          tax_code_id: 'vat',
          tax_rate: '20',
          withholding_code_id: null,
          withholding_rate: '0',
          receipt_line_id: null,
          order_line_id: null,
          tax_inclusive: true,
          variant_id: 'v1',
          warehouse_id: 'w2',
        },
      ],
    } as unknown as Parameters<typeof valuesFromInvoice>[0]
    const values = valuesFromInvoice(inv)
    expect(toInvoiceInput(values).lines[0]).toMatchObject({
      tax_inclusive: true,
      variant_id: 'v1',
      warehouse_id: 'w2',
    })
    expect(toPreviewInput(values)?.lines[0]).toMatchObject({
      tax_inclusive: true,
      variant_id: 'v1',
    })
  })
})
