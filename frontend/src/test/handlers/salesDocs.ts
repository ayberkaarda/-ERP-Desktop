import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import type {
  ApiDelivery,
  DeliveryLine,
  LotStock,
  OrderSource,
} from '@/features/sales/deliveries/types'
import type { ApiInvoice, InvoiceLine } from '@/features/sales/invoices/types'
import type { CustomerExposure, PrintModel } from '@/features/sales/invoices/kit/types'
import type { ApiReturn } from '@/features/sales/returns/types'
import type { CustomerSalesSummaryData } from '@/features/sales/reports/components/CustomerSalesSummary'
import { toIsoDate } from '@/lib/datetime'

// In-memory stand-in for the Sales delivery, invoice, return, customer and report endpoints as
// PHASE5 describes them (shapes assumed in .orchestra/fe-sales2.md), plus the read-only lookups
// the screens use (warehouses, tax codes, currencies, payment terms, parties, items, units, item
// categories, stock lots). Errors use the envelope {errors: {message, code, fields?}}.

export const PARTY_ACME = 'party-acme'
export const ITEM_BOLT = 'item-bolt'
export const ITEM_PHONE = 'item-phone'
export const ITEM_SERVICE = 'item-service'
export const UNIT_PCS = 'unit-pcs'
export const TAX_20 = 'tax-20'
export const WH_MAIN = 'wh-main'
export const ORDER_1 = 'order-1'
export const DELIVERY_DRAFT = 'delivery-draft'
export const DELIVERY_POSTED = 'delivery-posted'
export const INVOICE_DRAFT = 'invoice-draft'
export const INVOICE_ISSUED = 'invoice-issued'
export const RETURN_DRAFT = 'return-draft'

const D = (v: string | number) => new Decimal(v)

export const daysFromToday = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return toIsoDate(d)
}

export interface SalesCall {
  method: string
  path: string
  body: unknown
  url: URL
  headers: Headers
}

export interface SalesDocsDb {
  deliveries: ApiDelivery[]
  invoices: ApiInvoice[]
  returns: ApiReturn[]
  orders: OrderSource[]
  lots: (LotStock & { item_id: string; warehouse_id: string })[]
  exposure: Record<string, CustomerExposure>
  summary: Record<string, CustomerSalesSummaryData>
  /** Canned report rows and meta by API path. */
  reports: Record<string, { rows: Record<string, unknown>[]; meta: Record<string, unknown> }>
  creditMode: 'off' | 'warn' | 'block'
  /** When set, /stock-lots answers only after it resolves (slow responses). */
  lotsGate?: Promise<void>
  /** Permissions the API checks itself (credit override). */
  permissions: string[]
  /** Paths whose next N calls fail at the network level (lost response). */
  failNext: Record<string, number>
  calls: SalesCall[]
  idempotency: Map<string, { body: string; response: unknown; status: number }>
  seq: number
  numberSeq: Record<string, number>
}

const audit = [
  {
    event: 'created',
    description: 'created',
    causer_id: 'u1',
    causer_name: 'Deniz Kaya',
    created_at: '2026-10-01T08:00:00Z',
  },
]

const snapshot = {
  name: 'Acme Ticaret A.Ş.',
  tax_office: 'Kadıköy',
  tax_number: '1234567890',
  billing_address: { line1: 'Moda Cd. 1', city: 'İstanbul' },
}

function deliveryLine(over: Partial<DeliveryLine>): DeliveryLine {
  return {
    id: 'dl-1',
    line_no: 1,
    item_id: ITEM_BOLT,
    item_code: 'BOLT',
    item_name: 'Cıvata M8',
    item_tracking: 'lot',
    description: null,
    quantity: '2.000000',
    unit_id: UNIT_PCS,
    unit_code: 'ADET',
    base_quantity: '2.000000',
    warehouse_id: null,
    lot_no: 'L-A',
    serial_numbers: [],
    source_line_id: 'ol-1',
    unit_cost: null,
    invoiced_quantity: '0',
    ...over,
  }
}

function invoiceLine(over: Partial<InvoiceLine>): InvoiceLine {
  return {
    id: 'il-1',
    line_no: 1,
    item_id: ITEM_BOLT,
    item_code: 'BOLT',
    item_name: 'Cıvata M8',
    item_type: 'stock',
    description: 'Cıvata M8',
    quantity: '10.000000',
    unit_id: UNIT_PCS,
    unit_code: 'ADET',
    unit_price: '100.0000',
    discount_percent: '0.00',
    discount_amount: '0.0000',
    net_amount: '1000.0000',
    tax_code_id: TAX_20,
    tax_rate: '20.000000',
    tax_amount: '200.0000',
    line_total: '1200.0000',
    delivery_line_id: 'dl-p1',
    source_line_id: 'ol-1',
    returned_quantity: '0',
    ...over,
  }
}

const header = {
  party_id: PARTY_ACME,
  party_name: 'Acme Ticaret A.Ş.',
  party_snapshot: snapshot,
  currency_code: 'TRY',
  fx_rate: '1',
  warehouse_id: WH_MAIN,
  notes: null,
  internal_notes: null,
  source_type: null,
  source_id: null,
  created_at: '2026-10-01T08:00:00Z',
}

export function createSalesDocsDb(overrides: Partial<SalesDocsDb> = {}): SalesDocsDb {
  const deliveries: ApiDelivery[] = [
    {
      ...header,
      id: DELIVERY_DRAFT,
      number: null,
      status: 'draft',
      document_date: '2026-10-10',
      order_id: ORDER_1,
      order_number: 'SO2026000001',
      stock_document_id: null,
      journal_entry_id: null,
      warehouse_id: WH_MAIN,
      source_type: 'sales_order',
      source_id: ORDER_1,
      version: 1,
      lines: [deliveryLine({})],
      audit,
    },
    {
      ...header,
      id: DELIVERY_POSTED,
      number: 'IRS2026000001',
      status: 'posted',
      document_date: '2026-10-05',
      order_id: ORDER_1,
      order_number: 'SO2026000001',
      stock_document_id: 'stock-doc-1',
      journal_entry_id: 'je-cogs-1',
      warehouse_id: WH_MAIN,
      posted_at: '2026-10-05T09:00:00Z',
      invoiced_state: 'none',
      version: 2,
      lines: [
        deliveryLine({ id: 'dl-p1', quantity: '4.000000', lot_no: 'L-B', unit_cost: '61.2500' }),
      ],
      links: [{ type: 'sales_order', id: ORDER_1, number: 'SO2026000001', relation: 'source' }],
      audit,
    },
  ]
  const invoices: ApiInvoice[] = [
    {
      ...header,
      id: INVOICE_DRAFT,
      number: null,
      status: 'draft',
      invoice_type: 'sale',
      document_date: '2026-10-12',
      due_date: '2026-11-11',
      payment_term_id: null,
      price_list_id: null,
      subtotal: '1000.0000',
      discount_total: '0.0000',
      tax_total: '200.0000',
      total: '1200.0000',
      total_local: '1200.0000',
      paid_amount: '0.0000',
      balance_due: '0.0000',
      journal_entry_id: null,
      version: 3,
      lines: [invoiceLine({ id: 'il-d1' })],
      audit,
    },
    {
      ...header,
      id: INVOICE_ISSUED,
      number: 'SF2026000007',
      status: 'issued',
      invoice_type: 'sale',
      document_date: '2026-10-06',
      due_date: daysFromToday(-5),
      payment_term_id: null,
      price_list_id: null,
      subtotal: '1000.0000',
      discount_total: '0.0000',
      tax_total: '200.0000',
      total: '1200.0000',
      total_local: '1200.0000',
      paid_amount: '0.0000',
      balance_due: '1200.0000',
      journal_entry_id: 'je-inv-7',
      issued_at: '2026-10-06T10:00:00Z',
      version: 4,
      lines: [
        invoiceLine({ id: 'il-1', returned_quantity: '3.000000' }),
        invoiceLine({
          id: 'il-2',
          line_no: 2,
          item_id: ITEM_SERVICE,
          item_code: 'SRV',
          item_name: 'Montaj',
          item_type: 'service',
          description: 'Montaj',
          quantity: '1.000000',
          unit_price: '0.0000',
          net_amount: '0.0000',
          tax_amount: '0.0000',
          line_total: '0.0000',
          delivery_line_id: null,
          returned_quantity: '1.000000',
        }),
      ],
      links: [
        {
          type: 'sales_delivery',
          id: DELIVERY_POSTED,
          number: 'IRS2026000001',
          relation: 'source',
        },
      ],
      audit,
    },
  ]
  const returns: ApiReturn[] = [
    {
      ...header,
      id: RETURN_DRAFT,
      number: 'IA2026000002',
      status: 'draft',
      document_date: '2026-10-15',
      invoice_id: INVOICE_ISSUED,
      invoice_number: 'SF2026000007',
      reason: 'Hasarlı',
      total: '200.0000',
      version: 1,
      lines: [
        {
          id: 'rl-1',
          line_no: 1,
          invoice_line_id: 'il-1',
          delivery_line_id: 'dl-p1',
          item_id: ITEM_BOLT,
          item_code: 'BOLT',
          item_name: 'Cıvata M8',
          description: null,
          quantity: '2.000000',
          unit_id: UNIT_PCS,
          unit_code: 'ADET',
          unit_price: '100.0000',
          line_total: '200.0000',
          lot_no: 'L-B',
          serial_numbers: [],
          reason: null,
        },
      ],
      audit,
    },
  ]
  return {
    deliveries,
    invoices,
    returns,
    orders: [
      {
        id: ORDER_1,
        number: 'SO2026000001',
        status: 'confirmed',
        party_id: PARTY_ACME,
        party_name: 'Acme Ticaret A.Ş.',
        warehouse_id: WH_MAIN,
        currency_code: 'TRY',
        lines: [
          {
            id: 'ol-1',
            line_no: 1,
            item_id: ITEM_BOLT,
            item_code: 'BOLT',
            item_name: 'Cıvata M8',
            item_tracking: 'lot',
            item_type: 'stock',
            description: null,
            quantity: '10.000000',
            delivered_quantity: '4.000000',
            unit_id: UNIT_PCS,
            unit_code: 'ADET',
            warehouse_id: null,
          },
          {
            id: 'ol-2',
            line_no: 2,
            item_id: ITEM_PHONE,
            item_code: 'PHN',
            item_name: 'Telefon',
            item_tracking: 'serial',
            item_type: 'stock',
            description: null,
            quantity: '2.000000',
            delivered_quantity: '0',
            unit_id: UNIT_PCS,
            unit_code: 'ADET',
            warehouse_id: null,
          },
          {
            id: 'ol-3',
            line_no: 3,
            item_id: ITEM_SERVICE,
            item_code: 'SRV',
            item_name: 'Montaj',
            item_tracking: 'none',
            item_type: 'service',
            description: null,
            quantity: '1.000000',
            delivered_quantity: '0',
            unit_id: UNIT_PCS,
            unit_code: 'ADET',
            warehouse_id: null,
          },
        ],
      },
    ],
    lots: [
      {
        id: 'lot-b',
        lot_no: 'L-B',
        expiry_date: daysFromToday(40),
        on_hand: '3.000000',
        item_id: ITEM_BOLT,
        warehouse_id: WH_MAIN,
      },
      {
        id: 'lot-a',
        lot_no: 'L-A',
        expiry_date: daysFromToday(20),
        on_hand: '2.000000',
        item_id: ITEM_BOLT,
        warehouse_id: WH_MAIN,
      },
      {
        id: 'lot-x',
        lot_no: 'L-X',
        expiry_date: daysFromToday(-3),
        on_hand: '9.000000',
        item_id: ITEM_BOLT,
        warehouse_id: WH_MAIN,
      },
      {
        id: 'lot-n',
        lot_no: 'L-N',
        expiry_date: null,
        on_hand: '50.000000',
        item_id: ITEM_BOLT,
        warehouse_id: WH_MAIN,
      },
    ],
    exposure: {
      [PARTY_ACME]: {
        limit: '2000.0000',
        currency: 'TRY',
        open_invoices: '1200.0000',
        open_orders: '300.0000',
        total: '1500.0000',
        available: '500.0000',
      },
    },
    summary: {
      [PARTY_ACME]: {
        party_id: PARTY_ACME,
        currency: 'TRY',
        exposure: {
          party_id: PARTY_ACME,
          limit: '2000.00',
          currency: 'TRY',
          open_invoices: '1200.00',
          open_orders: '300.00',
          total: '1500.00',
          available: '500.00',
        },
        quotes: { open_count: 2, open_total: '800.00' },
        orders: { open_count: 1, open_value: '300.00' },
        invoices: {
          count: 7,
          invoiced_total: '15400.00',
          credited_total: '200.00',
          balance_due: '1200.00',
          last_invoice_date: '2026-10-06',
        },
        recent_orders: [
          {
            id: 'ord-recent-1',
            document_type: 'sales_order',
            number: 'ORD2026000000004',
            status: 'confirmed',
            document_date: '2026-10-01',
            total: '300.0000',
            currency_code: 'TRY',
          },
        ],
        recent_invoices: [
          {
            id: 'inv-recent-1',
            document_type: 'sales_invoice',
            number: 'INV2026000000007',
            status: 'issued',
            document_date: '2026-10-06',
            total: '1200.0000',
            currency_code: 'TRY',
            balance_due: '1200.0000',
          },
        ],
      },
    },
    reports: {
      '/sales-reports/sales-by-period': {
        rows: [
          {
            period: '2026-08',
            invoice_count: 3,
            gross_amount: '5000.0000',
            returns_amount: '0.0000',
            net_amount: '5000.0000',
            tax_amount: '1000.0000',
            total: '6000.0000',
          },
          {
            period: '2026-09',
            invoice_count: 4,
            gross_amount: '9600.0000',
            returns_amount: '200.0000',
            net_amount: '9400.0000',
            tax_amount: '1880.0000',
            total: '11280.0000',
          },
        ],
        meta: {
          totals: {
            invoice_count: '7',
            gross_amount: '14600.0000',
            returns_amount: '200.0000',
            net_amount: '14400.0000',
            tax_amount: '2880.0000',
            total: '17280.0000',
          },
        },
      },
      '/sales-reports/customer-ageing': {
        rows: [
          {
            code: 'C001',
            name: 'Acme Ticaret A.Ş.',
            not_due: '0.0000',
            d0_30: '1200.0000',
            d31_60: '0.0000',
            d61_90: '0.0000',
            d90_plus: '300.0000',
            total: '1500.0000',
          },
        ],
        meta: {
          totals: {
            not_due: '0.0000',
            d0_30: '1200.0000',
            d31_60: '0.0000',
            d61_90: '0.0000',
            d90_plus: '300.0000',
            total: '1500.0000',
          },
        },
      },
    },
    creditMode: 'warn',
    permissions: [],
    failNext: {},
    calls: [],
    idempotency: new Map(),
    seq: 0,
    numberSeq: {},
    ...overrides,
  }
}

function error(status: number, code: string, message: string, fields?: Record<string, string[]>) {
  return HttpResponse.json({ errors: { message, code, ...(fields ? { fields } : {}) } }, { status })
}
const validation = (fields: Record<string, string[]>) =>
  error(422, 'VALIDATION_ERROR', Object.values(fields)[0]?.[0] ?? 'Geçersiz.', fields)
const notFound = () => error(404, 'NOT_FOUND', 'Kayıt bulunamadı.')
const conflict = () =>
  error(409, 'VERSION_CONFLICT', 'Kayıt siz düzenlerken başka biri tarafından değiştirildi.')
const transition = () => error(409, 'INVALID_TRANSITION', 'Bu durumda işlem yapılamaz.')

function paginate<T>(rows: T[], url: URL, defaultPerPage = 25) {
  const perPage = Math.min(100, Number(url.searchParams.get('per_page') ?? defaultPerPage))
  const page = Number(url.searchParams.get('page') ?? 1)
  return {
    data: rows.slice((page - 1) * perPage, page * perPage),
    meta: {
      pagination: {
        total: rows.length,
        current_page: page,
        per_page: perPage,
        last_page: Math.max(1, Math.ceil(rows.length / perPage)),
      },
    },
  }
}

const strip = <T extends { lines?: unknown; audit?: unknown }>(d: T) => {
  const out: Partial<T> = { ...d }
  delete out.lines
  delete out.audit
  return out
}

/** Line amounts the way the API computes them (per-line rounding). */
function priceLine(l: {
  quantity: string
  unit_price: string | null
  discount_percent: string
  discount_amount: string
  tax_rate: string
}) {
  const price = D(l.unit_price ?? '100')
  const raw = D(l.quantity).mul(price)
  const net = raw
    .mul(D(1).minus(D(l.discount_percent).div(100)))
    .minus(D(l.discount_amount))
    .toDecimalPlaces(2)
  const tax = net.mul(D(l.tax_rate)).div(100).toDecimalPlaces(2)
  return {
    unit_price: price.toFixed(4),
    gross: raw.toDecimalPlaces(2),
    net,
    tax,
    total: net.plus(tax),
  }
}

export function salesDocsHandlers(db: SalesDocsDb) {
  const base = '*/api/v1'
  const record = async (request: Request) => {
    const url = new URL(request.url)
    let body: unknown = null
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      try {
        body = await request.clone().json()
      } catch {
        body = null
      }
    }
    const path = url.pathname.replace(/^.*\/api\/v1/, '')
    db.calls.push({ method: request.method, path, body, url, headers: request.headers })
    const fails = db.failNext[path] ?? 0
    if (fails > 0) {
      db.failNext[path] = fails - 1
      return { url, body, path, failed: true }
    }
    return { url, body, path, failed: false }
  }

  function idempotent(
    request: Request,
    payload: unknown,
    run: () => { status: number; body: unknown } | Response,
  ) {
    const key = request.headers.get('Idempotency-Key')
    if (!key) return error(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key gerekli.')
    const text = JSON.stringify(payload)
    const prior = db.idempotency.get(key)
    if (prior) {
      if (prior.body !== text)
        return error(422, 'IDEMPOTENCY_KEY_REUSED', 'Anahtar başka bir istekle kullanıldı.')
      return HttpResponse.json(prior.response as Record<string, unknown>, { status: prior.status })
    }
    const out = run()
    if (out instanceof Response) return out
    db.idempotency.set(key, { body: text, response: out.body, status: out.status })
    return HttpResponse.json(out.body as Record<string, unknown>, { status: out.status })
  }

  const nextNumber = (prefix: string) => {
    db.numberSeq[prefix] = (db.numberSeq[prefix] ?? 0) + 1
    return `${prefix}2026${String(db.numberSeq[prefix]).padStart(6, '0')}`
  }
  const newId = (p: string) => `${p}-${++db.seq}`
  const findOrder = (id: string) => db.orders.find((o) => o.id === id)

  const filterDocs = <
    T extends { status: string; party_id: string; document_date: string; number: string | null },
  >(
    rows: T[],
    url: URL,
  ) =>
    rows.filter((r) => {
      const f = (k: string) => url.searchParams.get(`filter[${k}]`)
      if (f('status') && r.status !== f('status')) return false
      if (f('party_id') && r.party_id !== f('party_id')) return false
      if (f('date_from') && r.document_date < (f('date_from') ?? '')) return false
      if (f('date_to') && r.document_date > (f('date_to') ?? '')) return false
      if (f('number') && !(r.number ?? '').includes(f('number') ?? '')) return false
      return true
    })

  const recomputeInvoice = (inv: ApiInvoice) => {
    let sub = D(0)
    let disc = D(0)
    let tax = D(0)
    let net = D(0)
    for (const l of inv.lines) {
      const p = priceLine(l)
      l.unit_price = p.unit_price
      l.net_amount = p.net.toFixed(4)
      l.tax_amount = p.tax.toFixed(4)
      l.line_total = p.total.toFixed(4)
      sub = sub.plus(p.gross)
      disc = disc.plus(p.gross.minus(p.net))
      tax = tax.plus(p.tax)
      net = net.plus(p.net)
    }
    inv.subtotal = sub.toFixed(4)
    inv.discount_total = disc.toFixed(4)
    inv.tax_total = tax.toFixed(4)
    inv.total = net.plus(tax).toFixed(4)
    inv.total_local = D(inv.total).mul(D(inv.fx_rate)).toDecimalPlaces(2).toFixed(4)
  }

  interface InvoiceBody {
    party_id: string
    document_date: string
    due_date: string | null
    currency_code: string
    fx_rate: string | null
    invoice_type: 'sale' | 'return'
    notes: string | null
    deliver_on_invoice: boolean
    lines: {
      item_id: string | null
      description: string | null
      quantity: string
      unit_id: string
      unit_price: string | null
      discount_percent: string
      discount_amount: string
      tax_code_id: string | null
      delivery_line_id: string | null
      source_line_id: string | null
    }[]
  }
  const invoiceLines = (id: string, lines: InvoiceBody['lines']): InvoiceLine[] =>
    lines.map((l, i) => ({
      id: `${id}-l${i + 1}`,
      line_no: i + 1,
      item_id: l.item_id,
      item_code: l.item_id === ITEM_BOLT ? 'BOLT' : null,
      item_name: l.item_id === ITEM_BOLT ? 'Cıvata M8' : null,
      item_type: l.item_id === ITEM_SERVICE ? 'service' : 'stock',
      description: l.description,
      quantity: l.quantity,
      unit_id: l.unit_id,
      unit_code: 'ADET',
      unit_price: l.unit_price ?? '100',
      discount_percent: l.discount_percent,
      discount_amount: l.discount_amount,
      net_amount: '0',
      tax_code_id: l.tax_code_id,
      tax_rate: l.tax_code_id === TAX_20 ? '20' : '0',
      tax_amount: '0',
      line_total: '0',
      delivery_line_id: l.delivery_line_id,
      source_line_id: l.source_line_id,
    }))

  const lookup = <T>(path: string, rows: () => T[]) =>
    http.get(`${base}${path}`, async ({ request }) => {
      await record(request)
      return HttpResponse.json(paginate(rows(), new URL(request.url), 100))
    })

  return [
    // ---- Exports (before the :id routes they would otherwise match) ----
    http.get(`${base}/:resource/export`, async ({ request }) => {
      const { url } = await record(request)
      const format = url.searchParams.get('format') ?? 'csv'
      return new HttpResponse('a;b\n1;2\n', {
        headers: {
          'Content-Type': format === 'csv' ? 'text/csv' : 'application/octet-stream',
          'Content-Disposition': `attachment; filename="export.${format}"`,
        },
      })
    }),
    http.get(`${base}/sales-reports/:name/export`, async ({ request }) => {
      const { url } = await record(request)
      const format = url.searchParams.get('format') ?? 'csv'
      return new HttpResponse('a;b\n1;2\n', {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="report.${format}"`,
        },
      })
    }),
    // ---- Lookups ----
    lookup('/warehouses', () => [
      { id: WH_MAIN, code: 'ANA', name: 'Ana depo', is_active: true, is_default: true, version: 1 },
    ]),
    lookup('/tax-codes', () => [
      {
        id: TAX_20,
        company_id: null,
        type: 'vat',
        code: 'KDV20',
        name: 'KDV %20',
        rate: '20',
        numerator: null,
        denominator: null,
        effective_from: '2020-01-01',
        effective_to: null,
        is_active: true,
        version: 1,
      },
    ]),
    lookup('/currencies', () => [
      { code: 'TRY', name: 'Türk lirası', symbol: '₺', decimals: 2, is_active: true },
      { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, is_active: true },
    ]),
    lookup('/payment-terms', () => [
      { id: 'pt-30', code: 'V30', name: '30 gün', due_days: 30, is_active: true, version: 1 },
    ]),
    lookup('/units', () => [
      { id: UNIT_PCS, code: 'ADET', name: 'Adet', symbol: null, is_active: true, version: 1 },
    ]),
    lookup('/item-categories', () => [
      { id: 'cat-1', code: 'HRD', name: 'Hırdavat', parent_id: null, version: 1 },
    ]),
    lookup('/parties', () => [
      {
        id: PARTY_ACME,
        code: 'C001',
        name: 'Acme Ticaret A.Ş.',
        roles: ['customer'],
        tax_number: '1234567890',
        payment_term_id: null,
        is_active: true,
      },
    ]),
    lookup('/items', () => [
      {
        id: ITEM_BOLT,
        code: 'BOLT',
        name: 'Cıvata M8',
        type: 'stock',
        base_unit_id: UNIT_PCS,
        category_id: 'cat-1',
        default_tax_code_id: TAX_20,
        tracking: 'lot',
        has_expiry: true,
        is_active: true,
        version: 1,
      },
      {
        id: ITEM_SERVICE,
        code: 'SRV',
        name: 'Montaj',
        type: 'service',
        base_unit_id: UNIT_PCS,
        category_id: null,
        default_tax_code_id: TAX_20,
        tracking: 'none',
        has_expiry: false,
        is_active: true,
        version: 1,
      },
    ]),
    http.get(`${base}/items/:id`, async ({ request, params }) => {
      await record(request)
      const id = String(params.id)
      if (id !== ITEM_BOLT && id !== ITEM_SERVICE) return notFound()
      return HttpResponse.json({
        data: {
          id,
          code: id === ITEM_BOLT ? 'BOLT' : 'SRV',
          name: id === ITEM_BOLT ? 'Cıvata M8' : 'Montaj',
          type: id === ITEM_BOLT ? 'stock' : 'service',
          base_unit_id: UNIT_PCS,
          category_id: null,
          default_tax_code_id: TAX_20,
          purchase_tax_code_id: null,
          tracking: id === ITEM_BOLT ? 'lot' : 'none',
          has_expiry: false,
          min_stock: null,
          reorder_point: null,
          is_active: true,
          attributes: {},
          version: 1,
        },
      })
    }),
    http.get(`${base}/stock-lots`, async ({ request }) => {
      const { url } = await record(request)
      if (db.lotsGate) await db.lotsGate
      const item = url.searchParams.get('filter[item_id]')
      const wh = url.searchParams.get('filter[warehouse_id]')
      const rows = db.lots.filter((l) => l.item_id === item && (!wh || l.warehouse_id === wh))
      return HttpResponse.json(paginate(rows, url, 100))
    }),

    // ---- Orders (read by the delivery editor) ----
    http.get(`${base}/sales-orders/:id`, async ({ request, params }) => {
      await record(request)
      const o = findOrder(String(params.id))
      return o ? HttpResponse.json({ data: o }) : notFound()
    }),

    // ---- Deliveries ----
    http.get(`${base}/sales-deliveries`, async ({ request }) => {
      const { url } = await record(request)
      return HttpResponse.json(
        paginate(
          filterDocs(db.deliveries, url).map((d) => ({ ...strip(d), line_count: d.lines.length })),
          url,
        ),
      )
    }),
    http.get(`${base}/sales-deliveries/:id/print-model`, async ({ request, params }) => {
      await record(request)
      const d = db.deliveries.find((x) => x.id === params.id)
      if (!d) return notFound()
      const model: PrintModel = {
        document_type: 'sales_delivery',
        title: 'Sevk İrsaliyesi',
        number: d.number,
        status: d.status,
        document_date: d.document_date,
        company: {
          name: 'Anadolu Makina A.Ş.',
          tax_office: 'Ümraniye',
          tax_number: '9990001112',
          address: 'İstanbul',
        },
        party: {
          name: snapshot.name,
          tax_office: snapshot.tax_office,
          tax_number: snapshot.tax_number,
          address: 'Moda Cd. 1, İstanbul',
        },
        lines: d.lines.map((l) => ({
          line_no: l.line_no,
          item_code: l.item_code ?? null,
          description: l.item_name ?? '',
          quantity: l.quantity,
          unit_code: l.unit_code ?? null,
          lot_no: l.lot_no,
          serial_numbers: l.serial_numbers,
        })),
      }
      return HttpResponse.json({ data: model })
    }),
    http.get(`${base}/sales-deliveries/:id`, async ({ request, params }) => {
      await record(request)
      const d = db.deliveries.find((x) => x.id === params.id)
      return d ? HttpResponse.json({ data: d }) : notFound()
    }),
    http.post(`${base}/sales-orders/:id/deliveries`, async ({ request, params }) => {
      const { body, failed } = await record(request)
      if (failed) return HttpResponse.error()
      const o = findOrder(String(params.id))
      if (!o) return notFound()
      const b = body as {
        document_date: string
        warehouse_id: string
        notes: string | null
        lines: {
          order_line_id: string
          quantity: string
          lot_no: string | null
          serial_numbers: string[]
          warehouse_id: string | null
        }[]
      }
      return idempotent(request, { order: o.id, ...b }, () => {
        for (const [i, l] of b.lines.entries()) {
          const ol = o.lines.find((x) => x.id === l.order_line_id)
          if (!ol)
            return validation({ [`lines.${i}.order_line_id`]: ['Sipariş satırı bulunamadı.'] })
          const remaining = D(ol.quantity).minus(D(ol.delivered_quantity))
          const asked = b.lines
            .filter((x) => x.order_line_id === l.order_line_id)
            .reduce((a, x) => a.plus(D(x.quantity)), D(0))
          if (asked.greaterThan(remaining))
            return validation({ [`lines.${i}.quantity`]: ['Kalan miktarı aşıyor.'] })
        }
        const id = newId('delivery')
        const d: ApiDelivery = {
          ...header,
          id,
          number: null,
          status: 'draft',
          document_date: b.document_date,
          order_id: o.id,
          order_number: o.number,
          warehouse_id: b.warehouse_id,
          stock_document_id: null,
          journal_entry_id: null,
          notes: b.notes,
          source_type: 'sales_order',
          source_id: o.id,
          version: 1,
          lines: b.lines.map((l, i) => {
            const ol = o.lines.find((x) => x.id === l.order_line_id)
            return deliveryLine({
              id: `${id}-l${i + 1}`,
              line_no: i + 1,
              item_id: ol?.item_id ?? '',
              item_code: ol?.item_code,
              item_name: ol?.item_name,
              item_tracking: ol?.item_tracking,
              quantity: l.quantity,
              base_quantity: l.quantity,
              lot_no: l.lot_no,
              serial_numbers: l.serial_numbers,
              source_line_id: l.order_line_id,
            })
          }),
        }
        db.deliveries.push(d)
        return { status: 201, body: { data: d } }
      })
    }),
    http.post(`${base}/sales-deliveries`, async ({ request }) => {
      const { body } = await record(request)
      const b = body as {
        party_id: string
        document_date: string
        warehouse_id: string
        notes: string | null
        lines: {
          item_id: string
          unit_id: string
          quantity: string
          lot_no: string | null
          serial_numbers: string[]
        }[]
      }
      return idempotent(request, b, () => {
        const id = newId('delivery')
        const d: ApiDelivery = {
          ...header,
          id,
          number: null,
          status: 'draft',
          document_date: b.document_date,
          order_id: null,
          warehouse_id: b.warehouse_id,
          stock_document_id: null,
          journal_entry_id: null,
          notes: b.notes,
          version: 1,
          lines: b.lines.map((l, i) =>
            deliveryLine({
              id: `${id}-l${i + 1}`,
              line_no: i + 1,
              item_id: l.item_id,
              quantity: l.quantity,
              lot_no: l.lot_no,
              serial_numbers: l.serial_numbers,
              source_line_id: null,
            }),
          ),
        }
        db.deliveries.push(d)
        return { status: 201, body: { data: d } }
      })
    }),
    http.patch(`${base}/sales-deliveries/:id`, async ({ request, params }) => {
      const { body } = await record(request)
      const d = db.deliveries.find((x) => x.id === params.id)
      if (!d) return notFound()
      const b = body as {
        version: number
        document_date: string
        warehouse_id: string
        notes: string | null
        lines: {
          source_line_id: string | null
          item_id: string
          quantity: string
          lot_no: string | null
          serial_numbers: string[]
        }[]
      }
      if (b.version !== d.version) return conflict()
      if (d.status !== 'draft') return transition()
      d.document_date = b.document_date
      d.warehouse_id = b.warehouse_id
      d.notes = b.notes
      d.lines = b.lines.map((l, i) => {
        const prev = d.lines.find(
          (x) => x.source_line_id === l.source_line_id && x.item_id === l.item_id,
        )
        return deliveryLine({
          ...prev,
          id: `${d.id}-l${i + 1}`,
          line_no: i + 1,
          item_id: l.item_id,
          quantity: l.quantity,
          lot_no: l.lot_no,
          serial_numbers: l.serial_numbers,
          source_line_id: l.source_line_id,
        })
      })
      d.version++
      return HttpResponse.json({ data: d })
    }),
    http.delete(`${base}/sales-deliveries/:id`, async ({ request, params }) => {
      const { url } = await record(request)
      const d = db.deliveries.find((x) => x.id === params.id)
      if (!d) return notFound()
      if (Number(url.searchParams.get('version')) !== d.version) return conflict()
      db.deliveries = db.deliveries.filter((x) => x !== d)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${base}/sales-deliveries/:id/post`, async ({ request, params }) => {
      const { body, failed, path } = await record(request)
      if (failed) return HttpResponse.error()
      const d = db.deliveries.find((x) => x.id === params.id)
      if (!d) return notFound()
      const b = body as { version: number }
      return idempotent(request, { path, ...b }, () => {
        if (b.version !== d.version) return conflict()
        if (d.status !== 'draft') return transition()
        d.status = 'posted'
        d.number = nextNumber('IRS')
        d.posted_at = '2026-10-21T10:00:00Z'
        d.stock_document_id = 'stock-doc-new'
        d.journal_entry_id = 'je-cogs-new'
        d.invoiced_state = 'none'
        d.version++
        return { status: 200, body: { data: d } }
      })
    }),
    http.post(`${base}/sales-deliveries/:id/cancel`, async ({ request, params }) => {
      const { body, path } = await record(request)
      const d = db.deliveries.find((x) => x.id === params.id)
      if (!d) return notFound()
      const b = body as { version: number; reason: string }
      return idempotent(request, { path, ...b }, () => {
        if (b.version !== d.version) return conflict()
        d.status = 'cancelled'
        d.cancel_reason = b.reason
        d.version++
        return { status: 200, body: { data: d } }
      })
    }),
    http.post(`${base}/sales-deliveries/:id/invoice`, async ({ request, params }) => {
      const { body, path } = await record(request)
      const d = db.deliveries.find((x) => x.id === params.id)
      if (!d) return notFound()
      return idempotent(request, { path, body }, () => {
        const id = newId('invoice')
        const inv: ApiInvoice = {
          ...header,
          id,
          number: null,
          status: 'draft',
          invoice_type: 'sale',
          document_date: (body as { document_date: string }).document_date,
          due_date: null,
          payment_term_id: null,
          price_list_id: null,
          subtotal: '0',
          discount_total: '0',
          tax_total: '0',
          total: '0',
          paid_amount: '0',
          balance_due: '0',
          journal_entry_id: null,
          source_type: 'sales_delivery',
          source_id: d.id,
          version: 1,
          lines: d.lines.map((l, i) =>
            invoiceLine({
              id: `${id}-l${i + 1}`,
              line_no: i + 1,
              quantity: l.quantity,
              delivery_line_id: l.id,
            }),
          ),
        }
        recomputeInvoice(inv)
        db.invoices.push(inv)
        return { status: 201, body: { data: inv } }
      })
    }),

    // ---- Invoices ----
    http.get(`${base}/sales-invoices`, async ({ request }) => {
      const { url } = await record(request)
      let rows = filterDocs(db.invoices, url)
      const type = url.searchParams.get('filter[invoice_type]')
      if (type) rows = rows.filter((r) => r.invoice_type === type)
      if (url.searchParams.get('filter[open]') === '1')
        rows = rows.filter((r) => D(r.balance_due).greaterThan(0))
      return HttpResponse.json(
        paginate(
          rows.map((d) => ({ ...strip(d), line_count: d.lines.length })),
          url,
        ),
      )
    }),
    http.get(`${base}/sales-invoices/:id/print-model`, async ({ request, params }) => {
      await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      if (!inv) return notFound()
      const model: PrintModel = {
        document_type: 'sales_invoice',
        title: 'Satış Faturası',
        number: inv.number,
        status: inv.status,
        document_date: inv.document_date,
        due_date: inv.due_date,
        currency_code: inv.currency_code,
        fx_rate: inv.fx_rate,
        company: {
          name: 'Anadolu Makina A.Ş.',
          tax_office: 'Ümraniye',
          tax_number: '9990001112',
          address: 'İstanbul',
        },
        party: {
          name: snapshot.name,
          tax_office: snapshot.tax_office,
          tax_number: snapshot.tax_number,
          address: 'Moda Cd. 1, İstanbul',
        },
        lines: inv.lines.map((l) => ({
          line_no: l.line_no,
          item_code: l.item_code ?? null,
          description: l.description ?? '',
          quantity: l.quantity,
          unit_code: l.unit_code ?? null,
          unit_price: l.unit_price,
          discount_percent: l.discount_percent,
          net_amount: l.net_amount,
          tax_rate: l.tax_rate,
          tax_amount: l.tax_amount,
          line_total: l.line_total,
        })),
        tax_summary: [{ tax_code: 'KDV20', rate: '20', base: inv.subtotal, amount: inv.tax_total }],
        totals: {
          subtotal: inv.subtotal,
          discount_total: inv.discount_total,
          tax_total: inv.tax_total,
          total: inv.total,
        },
        amount_in_words: 'Yalnız bin iki yüz Türk lirası',
      }
      return HttpResponse.json({ data: model })
    }),
    http.get(`${base}/sales-invoices/:id`, async ({ request, params }) => {
      await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      return inv ? HttpResponse.json({ data: inv }) : notFound()
    }),
    http.post(`${base}/sales-invoices`, async ({ request }) => {
      const { body } = await record(request)
      const b = body as InvoiceBody
      return idempotent(request, b, () => {
        if (b.lines.length === 0) return validation({ lines: ['En az bir satır gerekli.'] })
        const id = newId('invoice')
        const inv: ApiInvoice = {
          ...header,
          id,
          number: null,
          status: 'draft',
          invoice_type: b.invoice_type,
          document_date: b.document_date,
          due_date: b.due_date,
          currency_code: b.currency_code,
          fx_rate: b.fx_rate ?? '1',
          payment_term_id: null,
          price_list_id: null,
          notes: b.notes,
          subtotal: '0',
          discount_total: '0',
          tax_total: '0',
          total: '0',
          paid_amount: '0',
          balance_due: '0',
          journal_entry_id: null,
          deliver_on_invoice: b.deliver_on_invoice,
          version: 1,
          lines: invoiceLines(id, b.lines),
        }
        recomputeInvoice(inv)
        db.invoices.push(inv)
        return { status: 201, body: { data: inv } }
      })
    }),
    http.patch(`${base}/sales-invoices/:id`, async ({ request, params }) => {
      const { body } = await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      if (!inv) return notFound()
      const b = body as InvoiceBody & { version: number }
      if (b.version !== inv.version) return conflict()
      if (inv.status !== 'draft') return transition()
      inv.document_date = b.document_date
      inv.due_date = b.due_date
      inv.notes = b.notes
      inv.lines = invoiceLines(inv.id, b.lines)
      recomputeInvoice(inv)
      inv.version++
      return HttpResponse.json({ data: inv })
    }),
    http.delete(`${base}/sales-invoices/:id`, async ({ request, params }) => {
      const { url } = await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      if (!inv) return notFound()
      if (Number(url.searchParams.get('version')) !== inv.version) return conflict()
      db.invoices = db.invoices.filter((x) => x !== inv)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${base}/sales-invoices/:id/issue`, async ({ request, params }) => {
      const { body, path, failed } = await record(request)
      if (failed) return HttpResponse.error()
      const inv = db.invoices.find((x) => x.id === params.id)
      if (!inv) return notFound()
      const b = body as { version: number; credit_override_reason?: string }
      return idempotent(request, { path, ...b }, () => {
        if (b.version !== inv.version) return conflict()
        if (inv.status !== 'draft') return transition()
        const e = db.exposure[inv.party_id]
        const over =
          e?.available != null && D(inv.total_local ?? inv.total).greaterThan(D(e.available))
        const warnings: { code: string; message: string }[] = []
        if (over && db.creditMode === 'block') {
          if (!b.credit_override_reason)
            return error(422, 'sales.credit_limit_exceeded', 'Müşterinin risk limiti aşılıyor.')
          if (!db.permissions.includes('sales.credit_override'))
            return error(403, 'FORBIDDEN', 'Limit aşımı yetkisi yok.')
        }
        if (over && db.creditMode === 'warn')
          warnings.push({
            code: 'sales.credit_limit_warning',
            message: 'Risk limiti aşıldı (uyarı).',
          })
        inv.status = 'issued'
        inv.number = nextNumber('SF')
        inv.issued_at = '2026-10-21T10:00:00Z'
        inv.journal_entry_id = 'je-new'
        inv.balance_due = inv.total
        inv.version++
        return { status: 200, body: { data: inv, meta: { warnings } } }
      })
    }),
    http.post(`${base}/sales-invoices/:id/reverse`, async ({ request, params }) => {
      const { body, path } = await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      if (!inv) return notFound()
      const b = body as { version: number; date: string; reason: string; reverse_stock: boolean }
      return idempotent(request, { path, ...b }, () => {
        if (b.version !== inv.version) return conflict()
        if (inv.status !== 'issued') return transition()
        inv.status = 'reversed'
        inv.reversal_reason = b.reason
        inv.reversal_journal_entry_id = 'je-rev'
        inv.balance_due = '0.0000'
        inv.version++
        return { status: 200, body: { data: inv } }
      })
    }),
    http.post(`${base}/sales-documents/preview-totals`, async ({ request }) => {
      const { body } = await record(request)
      const b = body as InvoiceBody
      let sub = D(0)
      let disc = D(0)
      let tax = D(0)
      let net = D(0)
      const lines = b.lines.map((l) => {
        const p = priceLine({ ...l, tax_rate: l.tax_code_id === TAX_20 ? '20' : '0' })
        sub = sub.plus(p.gross)
        disc = disc.plus(p.gross.minus(p.net))
        tax = tax.plus(p.tax)
        net = net.plus(p.net)
        return {
          unit_price: p.unit_price,
          price_source: l.unit_price ? 'manual' : 'price_list:Liste',
          tax_rate: l.tax_code_id === TAX_20 ? '20' : '0',
          net_amount: p.net.toFixed(4),
          tax_amount: p.tax.toFixed(4),
          line_total: p.total.toFixed(4),
        }
      })
      return HttpResponse.json({
        data: {
          subtotal: sub.toFixed(4),
          discount_total: disc.toFixed(4),
          tax_total: tax.toFixed(4),
          total: net.plus(tax).toFixed(4),
          lines,
          warnings: [],
        },
      })
    }),

    // ---- Customers ----
    http.get(`${base}/customers/:id/exposure`, async ({ request, params }) => {
      await record(request)
      const e = db.exposure[String(params.id)]
      return e ? HttpResponse.json({ data: e }) : notFound()
    }),
    http.get(`${base}/customers/:id/sales-summary`, async ({ request, params }) => {
      await record(request)
      const s = db.summary[String(params.id)]
      return s ? HttpResponse.json({ data: s }) : notFound()
    }),

    // ---- Returns ----
    http.get(`${base}/sales-returns`, async ({ request }) => {
      const { url } = await record(request)
      return HttpResponse.json(
        paginate(
          filterDocs(db.returns, url).map((d) => ({ ...strip(d), line_count: d.lines.length })),
          url,
        ),
      )
    }),
    http.get(`${base}/sales-returns/:id`, async ({ request, params }) => {
      await record(request)
      const r = db.returns.find((x) => x.id === params.id)
      return r ? HttpResponse.json({ data: r }) : notFound()
    }),
    http.post(`${base}/sales-invoices/:id/returns`, async ({ request, params }) => {
      const { body } = await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      if (!inv) return notFound()
      const b = body as {
        document_date: string
        warehouse_id: string
        reason: string | null
        notes: string | null
        lines: { invoice_line_id: string; quantity: string; reason: string | null }[]
      }
      return idempotent(request, { invoice: inv.id, ...b }, () => {
        for (const [i, l] of b.lines.entries()) {
          const il = inv.lines.find((x) => x.id === l.invoice_line_id)
          if (!il) return validation({ [`lines.${i}.invoice_line_id`]: ['Fatura satırı yok.'] })
          if (D(l.quantity).greaterThan(D(il.quantity).minus(D(il.returned_quantity ?? '0'))))
            return validation({ [`lines.${i}.quantity`]: ['İade edilebilir miktarı aşıyor.'] })
        }
        const id = newId('return')
        const r: ApiReturn = {
          ...header,
          id,
          number: null,
          status: 'draft',
          document_date: b.document_date,
          warehouse_id: b.warehouse_id,
          invoice_id: inv.id,
          invoice_number: inv.number,
          reason: b.reason,
          notes: b.notes,
          version: 1,
          lines: b.lines.map((l, i) => {
            const il = inv.lines.find((x) => x.id === l.invoice_line_id)
            return {
              id: `${id}-l${i + 1}`,
              line_no: i + 1,
              invoice_line_id: l.invoice_line_id,
              delivery_line_id: il?.delivery_line_id ?? null,
              item_id: il?.item_id ?? null,
              item_code: il?.item_code,
              item_name: il?.item_name,
              description: il?.description ?? null,
              quantity: l.quantity,
              unit_id: UNIT_PCS,
              unit_code: 'ADET',
              unit_price: il?.unit_price,
              line_total: D(l.quantity)
                .mul(D(il?.unit_price ?? '0'))
                .toFixed(4),
              lot_no: null,
              serial_numbers: [],
              reason: l.reason,
            }
          }),
        }
        db.returns.push(r)
        return { status: 201, body: { data: r } }
      })
    }),
    http.post(`${base}/sales-returns/:id/:action`, async ({ request, params }) => {
      const { body, path } = await record(request)
      const r = db.returns.find((x) => x.id === params.id)
      if (!r) return notFound()
      const b = body as { version: number; date?: string; reason?: string }
      const action = String(params.action)
      return idempotent(request, { path, ...b }, () => {
        if (b.version !== r.version) return conflict()
        const next: Record<string, [string, ApiReturn['status']]> = {
          approve: ['draft', 'approved'],
          receive: ['approved', 'received'],
          credit: ['received', 'credited'],
        }
        if (action === 'cancel') {
          if (r.status !== 'draft' && r.status !== 'approved') return transition()
          r.status = 'cancelled'
        } else {
          const step = next[action]
          if (step === undefined) return transition()
          if (r.status !== step[0]) return transition()
          r.status = step[1]
          if (action === 'receive') {
            r.received_at = '2026-10-21T11:00:00Z'
            r.stock_document_id = 'stock-doc-ret'
          }
          if (action === 'credit') {
            r.credit_invoice_id = 'invoice-credit'
            r.credit_invoice_number = 'IF2026000001'
          }
        }
        r.version++
        return { status: 200, body: { data: r } }
      })
    }),
    http.delete(`${base}/sales-returns/:id`, async ({ request, params }) => {
      await record(request)
      db.returns = db.returns.filter((x) => x.id !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),

    // ---- Exports and reports ----
    http.get(`${base}/sales-reports/:name`, async ({ request, params }) => {
      const { url } = await record(request)
      const canned = db.reports[`/sales-reports/${String(params.name)}`]
      if (!canned) return HttpResponse.json({ data: [], meta: {} })
      if (url.searchParams.has('page')) {
        const p = paginate(canned.rows, url, 100)
        return HttpResponse.json({
          data: p.data,
          meta: { ...canned.meta, pagination: p.meta.pagination },
        })
      }
      return HttpResponse.json({ data: canned.rows, meta: canned.meta })
    }),
  ]
}
