import Decimal from 'decimal.js'
import { DEFAULT_LIST_QUERY } from '@/components/shared/data-table'
import { ApiError } from '@/platform'
import type { ApprovalRequest, ItemStockSummary } from '../api'
import type { SalesOrderLine } from '../types'
import { approvalSteps } from './approval'
import { readCreditBreakdown, isCreditLimitExceeded } from './errors'
import {
  deliverableQuantity,
  fulfilmentLines,
  invoiceableQuantity,
  needsDeliverOnInvoice,
  quantityProblem,
} from './fulfilment'
import { createPayloadKeys, stableStringify } from './idempotency'
import { buildChain, documentPath, exposureState, stockHint } from './insights'
import { orderActions, quoteActions } from './lifecycle'
import {
  addCalendarDays,
  baseQuantity,
  docSchema,
  emptyLine,
  emptyValues,
  factorOf,
  previewInput,
  serverFieldMapper,
  toInput,
  type DocMessages,
  type DocValues,
  type LineValues,
} from './lines'
import { sanitizeListQuery } from './listFilters'
import { sanitizeFilters, viewScope } from './savedViews'

const line = (over: Partial<LineValues> = {}): LineValues => ({
  ...emptyLine(),
  itemId: 'item-1',
  item: { id: 'item-1', code: 'A', name: 'A', type: 'stock', base_unit_id: 'u1' },
  unitId: 'u1',
  quantity: '2',
  ...over,
})

const values = (over: Partial<DocValues> = {}): DocValues => ({
  ...emptyValues('order', { today: '2026-10-21' }),
  partyId: 'p1',
  ...over,
})

const orderLine = (over: Partial<SalesOrderLine> = {}): SalesOrderLine => ({
  id: 'l1',
  line_no: 1,
  item_id: 'i1',
  item_type: 'stock',
  variant_id: null,
  description: null,
  quantity: '10.000000',
  unit_id: 'u1',
  base_quantity: '10.000000',
  unit_price: '1.0000',
  price_source: 'price_list',
  discount_percent: '0',
  discount_amount: '0',
  net_amount: '10.0000',
  tax_code_id: null,
  tax_rate: '0',
  tax_amount: '0',
  line_total: '10.0000',
  warehouse_id: null,
  source_line_id: null,
  delivered_quantity: '0.000000',
  invoiced_quantity: '0.000000',
  reservation_id: null,
  ...over,
})

describe('document form mapping', () => {
  it('defaults a quote validity from the document date', () => {
    expect(addCalendarDays('2026-12-15', 30)).toBe('2027-01-14')
    expect(emptyValues('quote', { today: '2026-10-21' }).validUntil).toBe('2026-11-20')
    expect(emptyValues('order', { today: '2026-10-21' }).validUntil).toBe('')
  })

  it('builds the body with decimal strings, drops blank lines and leaves auto prices null', () => {
    const v = values({
      lines: [
        line({ unitPrice: '', discountPercent: '5', id: 'stored-1' }),
        emptyLine(),
        line({ unitPrice: '12.5', discountAmount: '' }),
      ],
      requestedDeliveryDate: '2026-11-01',
      fxRate: '',
    })
    const input = toInput(v, 'order')
    expect(input.lines).toHaveLength(2)
    expect(input.lines[0]).toMatchObject({
      id: 'stored-1',
      unit_price: null,
      discount_percent: '5',
      discount_amount: '0',
      quantity: '2',
    })
    expect(input.lines[1]).toMatchObject({ unit_price: '12.5', discount_amount: '0' })
    expect(input.lines[1]).not.toHaveProperty('id')
    expect(input).toMatchObject({ requested_delivery_date: '2026-11-01', fx_rate: null })
    expect(input).not.toHaveProperty('valid_until')
    for (const l of input.lines) {
      for (const v of [l.quantity, l.discount_percent, l.discount_amount])
        expect(typeof v).toBe('string')
    }
  })

  it('previews only priceable lines, keyed, and nothing when no line can be priced', () => {
    const a = line({ key: 'ka' })
    const v = values({
      lines: [a, line({ key: 'kb', quantity: '0' }), line({ key: 'kc', unitId: '' })],
    })
    const body = previewInput(v, 'order')
    expect(body?.lines.map((l) => l.key)).toEqual(['ka'])
    expect(body?.lines[0]).toMatchObject({ unit_price: null, discount_percent: '0' })
    expect(previewInput(values({ lines: [emptyLine()] }), 'quote')).toBeNull()
  })

  it('maps server field paths to form paths skipping blank lines', () => {
    const v = values({ lines: [emptyLine(), line(), line()] })
    const map = serverFieldMapper(v)
    expect(map('lines.1.unit_price')).toBe('lines.2.unitPrice')
    expect(map('lines.0.quantity')).toBe('lines.1.quantity')
    expect(map('party_id')).toBe('partyId')
    expect(map('lines.9.quantity')).toBeNull()
    expect(map('lines.0.__proto__')).toBeNull()
    expect(map('unknown')).toBeNull()
  })

  it('validates lines, discounts and dates', () => {
    const m = Object.fromEntries(
      [
        'party',
        'currency',
        'minLines',
        'maxLines',
        'item',
        'unit',
        'quantity',
        'price',
        'discountPercent',
        'discountAmount',
        'validUntil',
        'fxRate',
      ].map((k) => [k, k]),
    ) as unknown as DocMessages
    const bad = docSchema('quote', m).safeParse(
      values({
        validUntil: '2026-10-01',
        lines: [
          line({ quantity: '0' }),
          line({ discountPercent: '101' }),
          line({ unitPrice: '1.23456' }),
        ],
      }),
    )
    expect(bad.success).toBe(false)
    const messages = bad.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`)
    expect(messages).toEqual(
      expect.arrayContaining([
        'validUntil:validUntil',
        'lines.0.quantity:quantity',
        'lines.1.discountPercent:discountPercent',
        'lines.2.unitPrice:price',
      ]),
    )
    const empty = docSchema('order', m).safeParse(values({ partyId: '', lines: [emptyLine()] }))
    expect(empty.error?.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining(['party', 'minLines']),
    )
    expect(docSchema('order', m).safeParse(values({ lines: [line()] })).success).toBe(true)
  })

  it('converts quantities to the base unit without floats', () => {
    expect(baseQuantity('2.5', '12')).toBe('30.000000')
    expect(baseQuantity('0.1', '0.3')).toBe('0.030000')
    expect(baseQuantity('x', '1')).toBeNull()
    expect(factorOf('2.000000', '24.000000')).toBe('12')
    expect(factorOf('0', '1')).toBe('1')
  })
})

describe('lifecycle', () => {
  it('offers quote actions by status', () => {
    expect(quoteActions('draft')).toEqual(['edit', 'delete', 'send'])
    expect(quoteActions('sent')).toEqual(['accept', 'reject', 'convert', 'revise'])
    expect(quoteActions('accepted')).toEqual(['convert'])
    expect(quoteActions('converted')).toEqual([])
  })

  it('allows revise only before deliveries and cancel only before deliveries or invoices', () => {
    expect(orderActions({ status: 'confirmed', lines: [orderLine()] })).toEqual([
      'revise',
      'cancel',
      'createDelivery',
      'createInvoice',
    ])
    const partly = orderActions({
      status: 'partially_delivered',
      lines: [orderLine({ delivered_quantity: '4', invoiced_quantity: '4' })],
    })
    expect(partly).toEqual(['createDelivery', 'createInvoice'])
    expect(
      orderActions({
        status: 'invoiced',
        lines: [orderLine({ delivered_quantity: '10', invoiced_quantity: '10' })],
      }),
    ).toEqual([])
    expect(orderActions({ status: 'pending_approval', lines: [] })).toEqual(['cancel'])
  })
})

describe('fulfilment bounds', () => {
  it('bounds deliveries by what is left plus the tolerance', () => {
    const l = orderLine({ delivered_quantity: '4' })
    expect(deliverableQuantity(l).toString()).toBe('6')
    expect(deliverableQuantity(l, '10').toString()).toBe('7')
    expect(deliverableQuantity(orderLine({ delivered_quantity: '12' })).toString()).toBe('0')
  })

  it('bounds invoices by delivered stock, ordered services and deliver-on-invoice', () => {
    const stock = orderLine({ delivered_quantity: '4', invoiced_quantity: '1' })
    expect(invoiceableQuantity(stock).toString()).toBe('3')
    expect(invoiceableQuantity(stock, true).toString()).toBe('9')
    const service = orderLine({ item_type: 'service', quantity: '2', invoiced_quantity: '0.5' })
    expect(invoiceableQuantity(service).toString()).toBe('1.5')
    expect(needsDeliverOnInvoice([stock])).toBe(true)
    expect(needsDeliverOnInvoice([service])).toBe(false)
  })

  it('checks typed quantities and keeps only positive ones', () => {
    const bound = new Decimal('3')
    expect(quantityProblem('', bound)).toBeNull()
    expect(quantityProblem('3', bound)).toBeNull()
    expect(quantityProblem('3.0000001', bound)).toBe('scale')
    expect(quantityProblem('3.5', bound)).toBe('exceeds')
    expect(quantityProblem('-1', bound)).toBe('invalid')
    expect(quantityProblem('1,5', bound)).toBe('invalid')
    expect(fulfilmentLines({ a: '2', b: '0', c: '', d: '0.5' })).toEqual([
      { order_line_id: 'a', quantity: '2' },
      { order_line_id: 'd', quantity: '0.5' },
    ])
  })
})

describe('insights', () => {
  const stock: ItemStockSummary = {
    item_id: 'i1',
    on_hand: '40',
    reserved: '0',
    available: '40',
    warehouses: [
      { warehouse_id: 'w1', on_hand: '30', reserved: '0', available: '30' },
      { warehouse_id: 'w2', on_hand: '10', reserved: '0', available: '10' },
    ],
  }

  it('rates availability in the document warehouse against the whole need', () => {
    expect(stockHint(stock, 'w1', new Decimal(10))).toEqual({ available: '30', tone: 'ok' })
    expect(stockHint(stock, 'w1', new Decimal(20))).toEqual({ available: '30', tone: 'low' })
    expect(stockHint(stock, 'w2', new Decimal(11))?.tone).toBe('short')
    expect(stockHint(stock, '', new Decimal(35))?.available).toBe('40')
    expect(stockHint(stock, 'w9', new Decimal(1))).toEqual({ available: '0', tone: 'short' })
    expect(stockHint(undefined, 'w1', new Decimal(1))).toBeNull()
  })

  it('computes the exposure state after this document', () => {
    const e = {
      party_id: 'p',
      limit: '1000.0000',
      currency: 'TRY',
      open_invoices: '500.0000',
      open_orders: '0.0000',
      total: '500.0000',
      available: '500.0000',
    }
    expect(exposureState(e, '100', 'TRY')).toEqual({ tone: 'ok', after: '400' })
    expect(exposureState(e, '350', 'TRY').tone).toBe('tight')
    expect(exposureState(e, '600', 'TRY')).toEqual({ tone: 'over', after: '-100' })
    // Another currency is not compared.
    expect(exposureState(e, '600', 'EUR').tone).toBe('ok')
    expect(exposureState({ ...e, limit: null, available: null }, '1', 'TRY').tone).toBe('unlimited')
  })

  it('orders the chain by stage and date and links each document', () => {
    const chain = buildChain(
      {
        type: 'sales_order',
        id: 'o1',
        number: 'S1',
        status: 'confirmed',
        document_date: '2026-10-02',
      },
      [
        {
          type: 'sales_invoice',
          id: 'i1',
          number: 'F1',
          status: 'issued',
          document_date: '2026-10-05',
          direction: 'downstream',
        },
        {
          type: 'sales_delivery',
          id: 'd2',
          number: 'D2',
          status: 'posted',
          document_date: '2026-10-04',
          direction: 'downstream',
        },
        {
          type: 'sales_delivery',
          id: 'd1',
          number: 'D1',
          status: 'posted',
          document_date: '2026-10-03',
          direction: 'downstream',
        },
        {
          type: 'sales_quote',
          id: 'q1',
          number: 'T1',
          status: 'converted',
          document_date: '2026-10-01',
          direction: 'upstream',
        },
        {
          type: 'sales_quote',
          id: 'q1',
          number: 'T1',
          status: 'converted',
          document_date: '2026-10-01',
          direction: 'upstream',
        },
      ],
    )
    expect(chain.map((n) => n.id)).toEqual(['q1', 'o1', 'd1', 'd2', 'i1'])
    expect(chain.find((n) => n.current)?.id).toBe('o1')
    expect(documentPath('sales_delivery', 'd 1')).toBe('/sales/deliveries/d%201')
  })
})

describe('errors, keys and saved views', () => {
  it('reads the credit breakdown from the error fields', () => {
    const err = new ApiError(422, 'sales.credit_limit_exceeded', 'Limit', {
      limit: ['1000.0000'],
      exposure: ['900.0000'],
      document: ['=1+1'],
      currency: ['TRY'],
    })
    expect(isCreditLimitExceeded(err)).toBe(true)
    expect(readCreditBreakdown(err)).toEqual({
      limit: '1000.0000',
      exposure: '900.0000',
      document: null,
      currency: 'TRY',
    })
    expect(readCreditBreakdown(new Error('x')).limit).toBeNull()
  })

  it('reuses the idempotency key for the same payload until reset', () => {
    let n = 0
    const keys = createPayloadKeys(() => `k${++n}`)
    expect(keys({ b: 1, a: [1, 2] })).toBe('k1')
    expect(keys({ a: [1, 2], b: 1 })).toBe('k1')
    expect(keys({ a: [1, 2], b: 2 })).toBe('k2')
    keys.reset()
    expect(keys({ a: [1, 2], b: 2 })).toBe('k3')
    expect(stableStringify({ z: undefined, y: null })).toBe('{"y":null}')
  })

  it('scopes saved views per user and company and drops unknown keys', () => {
    expect(viewScope('quotes', 'u1', 'c1')).toBe('sales.u1.c1.quotes')
    expect(viewScope('quotes', null, 'c1')).toBeNull()
    expect(
      sanitizeFilters(
        [
          { name: 'A', params: { status: 'draft', evil: 'x', party_id: 3 } },
          { name: 'A', params: {} },
          { name: '', params: {} },
          'junk',
        ],
        ['status', 'party_id'],
      ),
    ).toEqual([{ name: 'A', params: { status: 'draft' } }])
  })

  it('sends only allowlisted, well-formed list filters', () => {
    const q = sanitizeListQuery(
      {
        ...DEFAULT_LIST_QUERY,
        filters: { status: 'draft', date_from: 'yesterday', item_id: 'i1', location_id: 'x' },
      },
      false,
    )
    expect(q.filters).toEqual({ status: 'draft' })
  })

  it('maps approval decisions to timeline steps', () => {
    const approval: ApprovalRequest = {
      id: 'a',
      status: 'pending',
      current_step: 2,
      amount: '10',
      steps: [{ position: 1 }, { position: 2, name: 'Müdür' }, { position: 3 }],
      decisions: [
        {
          id: 'd',
          step_position: 1,
          actor_id: 'u',
          actor_name: 'Ali',
          decision: 'approve',
          comment: null,
          decided_at: '2026-10-21T08:00:00Z',
        },
      ],
    }
    expect(approvalSteps(approval).map((s) => s.state)).toEqual(['approved', 'pending', 'waiting'])
    expect(approvalSteps({ ...approval, status: 'rejected' })[2]?.state).toBe('skipped')
    expect(approvalSteps(approval)[0]?.decision?.actor).toBe('Ali')
  })
})
