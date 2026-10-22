import Decimal from 'decimal.js'
import { DEFAULT_LIST_QUERY } from '@/components/shared/data-table'
import { createPayloadKeys } from '@/features/sales/shared/lib/idempotency'
import { flattenLinks, toPreviewTotals } from '../api'
import type { OrderLine, PurchaseOrder, PurchaseRfq, RequestLine, RfqComparison } from '../types'
import { buildChain, documentPath } from './chain'
import { exposureView } from './exposure'
import { decimalProblem, lineName, plain } from './forms'
import {
  invoiceableQuantity,
  needsReceiveOnInvoice,
  openOnRequest,
  orderActions,
  quantityProblem,
  receivableQuantity,
  requestActions,
  rfqActions,
  unreceivedQuantity,
  wizardBound,
  wizardKeys,
} from './lifecycle'
import { sanitizeListQuery } from './listFilters'
import {
  emptyOrderLine,
  emptyOrderValues,
  orderFieldMapper,
  orderLinesUnchanged,
  orderPreviewInput,
  orderToInput,
  orderToValues,
  type OrderLineValues,
} from './orderForm'
import { awardSummary, lowestPicks, quoteInput, quoteRowProblem, quoteRows } from './rfq'

const orderLine = (over: Partial<OrderLine> = {}): OrderLine => ({
  id: 'l1',
  line_no: 1,
  item_id: 'i1',
  variant_id: null,
  item_type: 'stock',
  description: null,
  quantity: '10.000000',
  unit_id: 'u1',
  base_quantity: '10.000000',
  unit_price: '12.500000',
  tax_inclusive: false,
  discount_percent: '0.0000',
  discount_amount: '0.0000',
  gross_amount: '125.0000',
  line_discount: '0.0000',
  net_amount: '125.0000',
  tax_code_id: 't20',
  tax_rate: '20.000000',
  tax_amount: '25.0000',
  withholding_code_id: null,
  withholding_rate: '0.0000',
  withholding_amount: '0.0000',
  line_total: '150.0000',
  warehouse_id: null,
  source_line_id: null,
  price_source: 'manual',
  received_quantity: '0.000000',
  invoiced_quantity: '0.000000',
  request_line_id: null,
  rfq_line_id: null,
  expected_date: null,
  ...over,
})

const order = (over: Partial<PurchaseOrder> = {}): PurchaseOrder =>
  ({
    id: 'o1',
    document_type: 'purchase_order',
    number: 'POR1',
    status: 'approved',
    document_date: '2026-10-20',
    party_id: 'p1',
    party_name: 'Acme',
    currency_code: 'TRY',
    fx_rate: '1.000000',
    lines: [orderLine()],
    links: [],
    audit: [],
    tax_breakdown: [],
    version: 3,
    ...over,
  }) as PurchaseOrder

describe('wizard bounds (partial quantities)', () => {
  it('bounds receipts by the ordered quantity plus the tolerance, less what was received', () => {
    const l = orderLine({ received_quantity: '4.000000' })
    expect(receivableQuantity(l, '10').toString()).toBe('7')
    expect(receivableQuantity(l, '0').toString()).toBe('6')
    expect(unreceivedQuantity(l).toString()).toBe('6')
    // Unknown tolerance: unbounded here, the server checks.
    expect(receivableQuantity(l, null).isFinite()).toBe(false)
    expect(receivableQuantity(orderLine({ item_type: 'service' }), '10').toString()).toBe('0')
  })

  it('bounds invoices by what was received unless the invoice receives the goods', () => {
    const l = orderLine({ received_quantity: '4.000000', invoiced_quantity: '2.000000' })
    expect(invoiceableQuantity(l).toString()).toBe('2')
    expect(invoiceableQuantity(l, true).toString()).toBe('8')
    const service = orderLine({
      item_type: 'service',
      quantity: '3.000000',
      invoiced_quantity: '1.000000',
    })
    expect(invoiceableQuantity(service).toString()).toBe('2')
    expect(needsReceiveOnInvoice([l])).toBe(true)
    expect(needsReceiveOnInvoice([orderLine({ received_quantity: '10.000000' })])).toBe(false)
    expect(wizardBound('invoice', l, '10', false).toString()).toBe('2')
    expect(wizardBound('receipt', l, '10', false).toString()).toBe('7')
  })

  it('flags quantities above the bound, malformed text and more than 6 decimals', () => {
    const bound = new Decimal('6')
    expect(quantityProblem('6', bound)).toBeNull()
    expect(quantityProblem('6.000001', bound)).toBe('exceeds')
    expect(quantityProblem('1,5', bound)).toBe('invalid')
    expect(quantityProblem('-1', bound)).toBe('invalid')
    expect(quantityProblem('0.0000001', bound)).toBe('scale')
    expect(quantityProblem('', bound)).toBeNull()
  })

  it('keeps one wizard key per payload until the creation succeeded', () => {
    const payload = {
      company: 'c',
      mode: 'receipt',
      order: 'o1',
      lines: [{ order_line_id: 'l1', quantity: '2' }],
    }
    const first = wizardKeys.keyFor(payload)
    expect(wizardKeys.keyFor({ ...payload })).toBe(first)
    expect(
      wizardKeys.keyFor({ ...payload, lines: [{ order_line_id: 'l1', quantity: '3' }] }),
    ).not.toBe(first)
    wizardKeys.release(payload)
    expect(wizardKeys.keyFor(payload)).not.toBe(first)
  })
})

describe('lifecycle', () => {
  it('offers order actions by status and documents', () => {
    expect(orderActions(order({ status: 'draft' }))).toEqual(['edit', 'delete', 'submit', 'cancel'])
    expect(orderActions(order({ status: 'approved' }))).toEqual([
      'send',
      'revise',
      'cancel',
      'createReceipt',
      'createInvoice',
      'close',
    ])
    const progressed = order({
      status: 'partially_received',
      lines: [orderLine({ received_quantity: '4.000000' })],
    })
    expect(orderActions(progressed)).toEqual(['createReceipt', 'createInvoice', 'close'])
    // A draft receipt in the links blocks revise and cancel even before quantities move.
    const linked = order({
      status: 'sent',
      links: [
        {
          type: 'purchase_receipt',
          id: 'g1',
          number: null,
          status: 'draft',
          document_date: '2026-10-21',
          total: null,
          currency_code: 'TRY',
        },
      ],
    })
    expect(orderActions(linked)).not.toContain('revise')
    expect(orderActions(order({ status: 'invoiced' }))).toEqual(['close'])
    expect(orderActions(order({ status: 'cancelled' }))).toEqual([])
  })

  it('offers request conversions only while something is open', () => {
    const line = { id: 'r1', quantity: '10.000000', ordered: '4.000000' } as RequestLine
    expect(openOnRequest(line).toString()).toBe('6')
    expect(requestActions('approved', [line])).toEqual(['toRfq', 'toOrder', 'cancel'])
    expect(requestActions('partially_ordered', [{ ...line, ordered: '10' }])).toEqual(['cancel'])
    expect(requestActions('rejected', [line])).toEqual(['edit', 'cancel'])
    expect(rfqActions('collecting', 0)).toEqual(['quotes', 'cancel'])
    expect(rfqActions('collecting', 2)).toEqual(['quotes', 'award', 'cancel'])
  })
})

describe('order form (decimal strings)', () => {
  const values = () => {
    const v = emptyOrderValues('2026-10-22')
    const line: OrderLineValues = {
      ...emptyOrderLine(),
      itemId: 'i1',
      unitId: 'u1',
      quantity: '3',
      unitPrice: '0.1',
      discountPercent: '12.5',
      taxCodeId: 't20',
    }
    return { ...v, partyId: 'p1', lines: [line, emptyOrderLine()] }
  }

  it('sends money and quantities as the typed decimal strings, never as numbers', () => {
    const input = orderToInput(values())
    expect(input.lines).toHaveLength(1)
    const line = input.lines?.[0]
    expect(line).toMatchObject({
      quantity: '3',
      unit_price: '0.1',
      discount_percent: '12.5',
      discount_amount: '0',
      tax_code_id: 't20',
      withholding_code_id: null,
    })
    for (const v of Object.values(line ?? {})) expect(typeof v).not.toBe('number')
    expect(JSON.stringify(input)).not.toMatch(/0\.30000000000000004/)
  })

  it('previews only computable lines and needs the supplier', () => {
    const v = values()
    expect(orderPreviewInput(v)?.lines.map((l) => l.unit_price)).toEqual(['0.1'])
    expect(orderPreviewInput({ ...v, partyId: '' })).toBeNull()
  })

  it('leaves unchanged stored lines out and maps server fields to form lines', () => {
    const stored = order({ status: 'draft', lines: [orderLine({ price_source: 'quote' })] })
    const v = orderToValues(stored)
    expect(v.lines[0]?.unitPrice).toBe('12.5')
    expect(orderLinesUnchanged(v, stored)).toBe(true)
    expect(
      orderLinesUnchanged({ ...v, lines: v.lines.map((l) => ({ ...l, quantity: '11' })) }, stored),
    ).toBe(false)
    const map = orderFieldMapper(values())
    expect(map('lines.0.unit_price')).toBe('lines.0.unitPrice')
    expect(map('lines.1.quantity')).toBeNull()
    expect(map('party_id')).toBe('partyId')
  })

  it('validates decimals with the API scales', () => {
    expect(decimalProblem('12.123456', { scale: 6 })).toBe(false)
    expect(decimalProblem('12.1234567', { scale: 6 })).toBe(true)
    expect(decimalProblem('100.0001', { scale: 4, max: '100' })).toBe(true)
    expect(decimalProblem('', { scale: 4, optional: true })).toBe(false)
    expect(plain('10.500000')).toBe('10.5')
    expect(lineName({ item_code: 'A', item_name: 'B' })).toBe('A · B')
  })
})

describe('preview, links, exposure', () => {
  it('keys preview lines like the request and keeps amounts as strings', () => {
    const totals = toPreviewTotals(
      {
        party_id: 'p1',
        document_date: '2026-10-22',
        currency_code: 'TRY',
        fx_rate: null,
        warehouse_id: null,
        lines: [
          {
            key: 'k1',
            item_id: 'i1',
            variant_id: null,
            unit_id: 'u1',
            quantity: '3',
            unit_price: '0.1',
            discount_percent: '0',
            discount_amount: '0',
            tax_code_id: 't',
            withholding_code_id: 'w',
            warehouse_id: null,
          },
        ],
      },
      {
        header: { currency_code: 'TRY', fx_rate: '1.000000' },
        lines: [
          {
            unit_price: '0.100000',
            price_source: 'manual',
            base_quantity: '3.000000',
            net_amount: '0.3000',
            tax_code_id: 't',
            tax_rate: '20.000000',
            tax_amount: '0.0600',
            withholding_amount: '0.0300',
            line_total: '0.3600',
          },
        ],
        taxes: [{ tax_code_id: 't', rate: '20.000000', base: '0.3000', tax: '0.0600' }],
        totals: {
          subtotal: '0.3000',
          discount_total: '0.0000',
          tax_total: '0.0600',
          withholding_total: '0.0300',
          total: '0.3600',
          total_local: '0.3600',
        },
      },
      [{ code: 'x', message: 'y', line: 0 }],
    )
    expect(totals.lines[0]).toMatchObject({
      key: 'k1',
      net_amount: '0.3000',
      withholding_amount: '0.0300',
    })
    expect(totals.withholding_total).toBe('0.0300')
    expect(totals.warnings[0]).toMatchObject({ line_key: 'k1', line_no: 1 })
  })

  it('flattens links, drops hidden relations and orders the chain by stage', () => {
    const links = flattenLinks({
      request: {
        id: 'r1',
        document_type: 'purchase_request',
        number: 'PRQ1',
        status: 'ordered',
        document_date: '2026-10-01',
        total: '10',
        currency_code: 'TRY',
      },
      receipts: [],
      invoices: [
        {
          id: 'i1',
          document_type: 'purchase_invoice',
          number: null,
          status: 'draft',
          document_date: '2026-10-21',
          total: null,
          currency_code: 'TRY',
        },
      ],
      rfq: null,
    })
    expect(links.map((l) => l.type)).toEqual(['purchase_request', 'purchase_invoice'])
    const chain = buildChain(
      {
        type: 'purchase_order',
        id: 'o1',
        number: 'POR1',
        status: 'sent',
        document_date: '2026-10-05',
        total: '1',
        currency_code: 'TRY',
      },
      links,
    )
    expect(chain.map((n) => n.type)).toEqual([
      'purchase_request',
      'purchase_order',
      'purchase_invoice',
    ])
    expect(chain.find((n) => n.current)?.id).toBe('o1')
    expect(documentPath('purchase_debit_note', 'x y')).toBe('/purchasing/invoices/x%20y')
  })

  it('adds a draft to the exposure with decimals and flags overdue payables', () => {
    const e = {
      party_id: 'p',
      currency: 'TRY',
      open_payables: '0.10',
      open_orders: '0.20',
      total: '0.30',
      overdue_payables: '0.00',
    }
    expect(exposureView(e, '0.1', false)).toEqual({ tone: 'open', after: '0.40' })
    expect(exposureView(e, '0.1', true).after).toBeNull()
    expect(exposureView({ ...e, overdue_payables: '5.00' }, null, false).tone).toBe('overdue')
  })
})

describe('RFQ helpers', () => {
  const rfq = {
    id: 'q1',
    version: 4,
    lines: [
      { id: 'l1', quantity: '10.000000' },
      { id: 'l2', quantity: '5.000000' },
    ],
    quotes: [
      {
        id: 'a',
        rfq_line_id: 'l1',
        party_id: 'p1',
        unit_price: '9.000000',
        discount_percent: '10.0000',
        net_unit_price: '8.100000',
        lead_time_days: 5,
        valid_until: null,
        notes: 'n',
      },
    ],
  } as unknown as PurchaseRfq

  it('prefills quote rows and sends only priced rows as strings', () => {
    const rows = quoteRows(rfq, 'p1')
    expect(rows[0]).toMatchObject({
      unitPrice: '9',
      discountPercent: '10',
      leadTimeDays: '5',
      notes: 'n',
    })
    expect(rows[1]?.unitPrice).toBe('')
    expect(quoteInput('p1', rows, false, 4)).toEqual({
      party_id: 'p1',
      version: 4,
      quotes: [
        {
          rfq_line_id: 'l1',
          unit_price: '9',
          discount_percent: '10',
          lead_time_days: 5,
          valid_until: null,
          notes: 'n',
        },
      ],
    })
    expect(quoteInput('p1', rows, true, 4)).toEqual({ party_id: 'p1', declined: true, version: 4 })
    expect(
      quoteRowProblem({
        rfqLineId: 'l1',
        unitPrice: '9',
        discountPercent: '',
        leadTimeDays: '4000',
        validUntil: '',
        notes: '',
      }),
    ).toBe('leadTime')
  })

  it('picks the lowest quote per line and sums award totals as decimals', () => {
    const comparison: RfqComparison = {
      rfq_id: 'q1',
      currency_code: 'TRY',
      lowest_total_party_id: null,
      suppliers: [],
      lines: [
        {
          rfq_line_id: 'l1',
          line_no: 1,
          item_id: 'i',
          description: null,
          quantity: '3',
          unit_id: 'u',
          awarded_party_id: null,
          quotes: [
            {
              quote_id: 'b',
              party_id: 'p2',
              party_name: 'B',
              unit_price: '0.1',
              discount_percent: '0',
              net_unit_price: '0.1',
              line_total: '0.10',
              lead_time_days: null,
              valid_until: null,
              notes: null,
              lowest_price: true,
              fastest: false,
            },
            {
              quote_id: 'a',
              party_id: 'p1',
              party_name: 'A',
              unit_price: '0.2',
              discount_percent: '0',
              net_unit_price: '0.2',
              line_total: '0.20',
              lead_time_days: 1,
              valid_until: null,
              notes: null,
              lowest_price: false,
              fastest: true,
            },
          ],
        },
        {
          rfq_line_id: 'l2',
          line_no: 2,
          item_id: 'i',
          description: null,
          quantity: '1',
          unit_id: 'u',
          awarded_party_id: null,
          quotes: [
            {
              quote_id: 'c',
              party_id: 'p2',
              party_name: 'B',
              unit_price: '0.2',
              discount_percent: '0',
              net_unit_price: '0.2',
              line_total: '0.20',
              lead_time_days: null,
              valid_until: null,
              notes: null,
              lowest_price: true,
              fastest: false,
            },
          ],
        },
      ],
    }
    const picks = lowestPicks(comparison)
    expect(picks).toEqual({ l1: 'p2', l2: 'p2' })
    expect(awardSummary(comparison, picks)).toEqual([
      { party_id: 'p2', party_name: 'B', lines: 2, total: '0.30' },
    ])
  })
})

describe('list filters', () => {
  it('passes only allowlisted filters and sorts of the list', () => {
    const q = sanitizeListQuery(
      'request',
      {
        ...DEFAULT_LIST_QUERY,
        filters: { status: 'draft', supplier: 's1', item_id: 'i1', date_from: 'x', evil: '1' },
        sort: [
          { id: 'party_name', desc: false },
          { id: 'needed_by', desc: true },
        ],
      },
      { items: false, parties: true },
    )
    expect(q.filters).toEqual({ status: 'draft', supplier: 's1' })
    expect(q.sort).toEqual([{ id: 'needed_by', desc: true }])
  })
})

describe('payload keys', () => {
  it('reuses the key for a retried identical submit and renews it after success', () => {
    let n = 0
    const keys = createPayloadKeys(() => `k${++n}`)
    expect(keys({ submit: 'o1', version: 1 })).toBe('k1')
    expect(keys({ version: 1, submit: 'o1' })).toBe('k1')
    keys.reset()
    expect(keys({ submit: 'o1', version: 1 })).toBe('k2')
  })
})
