import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import type {
  ApiDeliveryLine,
  ApiOrderLine,
  RawDelivery,
  RawOrder,
} from '@/features/sales/deliveries/types'
import type { ApiInvoiceLine, RawInvoice } from '@/features/sales/invoices/types'
import type {
  ApiHeader,
  ApiLine,
  ApiLink,
  ApiLinks,
  CustomerExposure,
  PrintModel,
} from '@/features/sales/invoices/kit/types'
import type { ApiReturnLine, RawReturn } from '@/features/sales/returns/types'
import type { CustomerSalesSummaryData } from '@/features/sales/reports/components/CustomerSalesSummary'
import { toIsoDate } from '@/lib/datetime'

// In-memory stand-in for the Sales delivery, invoice, return and customer endpoints with the real
// wire shapes (Sales DocumentResource/LineResource/DocumentLinks/PrintModel: flat party snapshot,
// ids only on lines, named `links` on details, preview `{header, lines, taxes, totals}`), plus the
// read-only lookups the screens use (warehouses, tax codes, currencies, payment terms, parties,
// items with filter[id], units, categories, stock-balances detail) and canned report rows.
// Errors use the envelope {errors: {message, code, fields?, details?}}.

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

/** A lot balance row of GET /stock-balances?group_by=detail. */
export interface LotBalance {
  lot_id: string
  lot_no: string
  expiry_date: string | null
  on_hand: string
  item_id: string
  warehouse_id: string
}

export interface SalesDocsDb {
  deliveries: RawDelivery[]
  invoices: RawInvoice[]
  returns: RawReturn[]
  orders: RawOrder[]
  lots: LotBalance[]
  exposure: Record<string, CustomerExposure>
  summary: Record<string, CustomerSalesSummaryData>
  /** Canned report rows and meta by API path. */
  reports: Record<string, { rows: Record<string, unknown>[]; meta: Record<string, unknown> }>
  creditMode: 'off' | 'warn' | 'block'
  /** When set, /stock-balances answers only after it resolves (slow responses). */
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
    properties: null,
    created_at: '2026-10-01T08:00:00Z',
  },
]

const ITEMS = [
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
    id: ITEM_PHONE,
    code: 'PHN',
    name: 'Telefon',
    type: 'stock',
    base_unit_id: UNIT_PCS,
    category_id: null,
    default_tax_code_id: TAX_20,
    tracking: 'serial',
    has_expiry: false,
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
]

const itemType = (id: string | null) => (id === ITEM_SERVICE ? 'service' : 'stock')

/** Header columns as DocumentResource sends them. */
function rawHeader(over: Partial<ApiHeader> & Pick<ApiHeader, 'id' | 'document_type'>): ApiHeader {
  return {
    number: null,
    status: 'draft',
    document_date: '2026-10-10',
    party_id: PARTY_ACME,
    party_name: 'Acme Ticaret A.Ş.',
    party_tax_office: 'Kadıköy',
    party_tax_number: '1234567890',
    billing_address: { line1: 'Moda Cd. 1', city: 'İstanbul' },
    currency_code: 'TRY',
    fx_rate: '1.000000',
    payment_term_id: null,
    due_date: null,
    price_list_id: null,
    warehouse_id: WH_MAIN,
    cost_center_id: null,
    project_id: null,
    notes: null,
    internal_notes: null,
    source_type: null,
    source_id: null,
    subtotal: '0.0000',
    discount_total: '0.0000',
    tax_total: '0.0000',
    total: '0.0000',
    subtotal_local: '0.0000',
    discount_total_local: '0.0000',
    tax_total_local: '0.0000',
    total_local: '0.0000',
    version: 1,
    created_by: 'u1',
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z',
    ...over,
  }
}

/** Line columns as LineResource sends them. */
function rawLine(over: Partial<ApiLine> & Pick<ApiLine, 'id'>): ApiLine {
  return {
    line_no: 1,
    item_id: ITEM_BOLT,
    variant_id: null,
    item_type: 'stock',
    description: null,
    quantity: '1.000000',
    unit_id: UNIT_PCS,
    base_quantity: '1.000000',
    unit_price: '100.000000',
    tax_inclusive: false,
    discount_percent: '0.0000',
    discount_amount: '0.0000',
    gross_amount: '0.0000',
    line_discount: '0.0000',
    net_amount: '0.0000',
    tax_code_id: TAX_20,
    tax_rate: '20.000000',
    tax_amount: '0.0000',
    line_total: '0.0000',
    warehouse_id: null,
    source_line_id: null,
    price_source: 'default_price_list',
    ...over,
  }
}

function deliveryLine(over: Partial<ApiDeliveryLine> & Pick<ApiLine, 'id'>): ApiDeliveryLine {
  return {
    ...rawLine({ quantity: '2.000000', base_quantity: '2.000000', ...over }),
    order_line_id: 'ol-1',
    lot_no: 'L-A',
    serial_numbers: [],
    unit_cost: null,
    cost_total: null,
    ...over,
  }
}

function invoiceLine(over: Partial<ApiInvoiceLine> & Pick<ApiLine, 'id'>): ApiInvoiceLine {
  return {
    ...rawLine({
      description: 'Cıvata M8',
      quantity: '10.000000',
      base_quantity: '10.000000',
      gross_amount: '1000.0000',
      net_amount: '1000.0000',
      tax_amount: '200.0000',
      line_total: '1200.0000',
      ...over,
    }),
    order_line_id: 'ol-1',
    delivery_line_id: null,
    original_line_id: null,
    ...over,
  }
}

function orderLine(over: Partial<ApiOrderLine> & Pick<ApiLine, 'id'>): ApiOrderLine {
  return {
    ...rawLine(over),
    delivered_quantity: '0.000000',
    invoiced_quantity: '0.000000',
    reservation_id: null,
    ...over,
  }
}

const deliveryFields = {
  order_id: ORDER_1,
  invoice_id: null,
  stock_document_id: null,
  journal_entry_id: null,
  cost_total: '0.0000',
  posted_at: null,
  posted_by: null,
  cancelled_at: null,
  cancel_reason: null,
  reversal_stock_document_id: null,
}

const invoiceFields = {
  invoice_type: 'sale' as const,
  order_id: null,
  delivery_id: null,
  return_id: null,
  original_invoice_id: null,
  deliver_on_invoice: false,
  journal_entry_id: null,
  reversal_journal_entry_id: null,
  paid_amount: '0.0000',
  balance_due: '0.0000',
  issued_at: null,
  issued_by: null,
  reversed_at: null,
  reversal_date: null,
  reversal_reason: null,
  credit_override_reason: null,
  e_document_status: null,
  e_document_uuid: null,
}

const returnFields = {
  reason: null,
  stock_document_id: null,
  journal_entry_id: null,
  credit_invoice_id: null,
  approved_at: null,
  received_at: null,
  credited_at: null,
  cancelled_at: null,
}

export function createSalesDocsDb(overrides: Partial<SalesDocsDb> = {}): SalesDocsDb {
  const deliveries: RawDelivery[] = [
    {
      ...rawHeader({
        id: DELIVERY_DRAFT,
        document_type: 'sales_delivery',
        source_type: 'sales_order',
        source_id: ORDER_1,
      }),
      ...deliveryFields,
      status: 'draft',
      lines: [deliveryLine({ id: 'dl-1', source_line_id: 'ol-1' })],
      audit,
    },
    {
      ...rawHeader({
        id: DELIVERY_POSTED,
        document_type: 'sales_delivery',
        number: 'DLV2026000000001',
        document_date: '2026-10-05',
        source_type: 'sales_order',
        source_id: ORDER_1,
        version: 2,
      }),
      ...deliveryFields,
      status: 'posted',
      stock_document_id: 'stock-doc-1',
      journal_entry_id: 'je-cogs-1',
      cost_total: '245.0000',
      posted_at: '2026-10-05T09:00:00Z',
      lines: [
        deliveryLine({
          id: 'dl-p1',
          quantity: '4.000000',
          base_quantity: '4.000000',
          lot_no: 'L-B',
          unit_cost: '61.250000',
          cost_total: '245.0000',
        }),
      ],
      audit,
    },
  ]
  const invoices: RawInvoice[] = [
    {
      ...rawHeader({
        id: INVOICE_DRAFT,
        document_type: 'sales_invoice',
        document_date: '2026-10-12',
        due_date: '2026-11-11',
        subtotal: '1000.0000',
        tax_total: '200.0000',
        total: '1200.0000',
        subtotal_local: '1000.0000',
        tax_total_local: '200.0000',
        total_local: '1200.0000',
        version: 3,
      }),
      ...invoiceFields,
      status: 'draft',
      lines: [invoiceLine({ id: 'il-d1' })],
      audit,
    },
    {
      ...rawHeader({
        id: INVOICE_ISSUED,
        document_type: 'sales_invoice',
        number: 'INV2026000000007',
        document_date: '2026-10-06',
        due_date: daysFromToday(-5),
        subtotal: '1000.0000',
        tax_total: '200.0000',
        total: '1200.0000',
        subtotal_local: '1000.0000',
        tax_total_local: '200.0000',
        total_local: '1200.0000',
        version: 4,
      }),
      ...invoiceFields,
      status: 'issued',
      order_id: ORDER_1,
      journal_entry_id: 'je-inv-7',
      balance_due: '1200.0000',
      issued_at: '2026-10-06T10:00:00Z',
      lines: [
        invoiceLine({ id: 'il-1' }),
        invoiceLine({
          id: 'il-2',
          line_no: 2,
          item_id: ITEM_SERVICE,
          item_type: 'service',
          description: 'Montaj',
          quantity: '1.000000',
          unit_price: '0.000000',
          gross_amount: '0.0000',
          net_amount: '0.0000',
          tax_amount: '0.0000',
          line_total: '0.0000',
          order_line_id: 'ol-3',
          delivery_line_id: null,
        }),
      ],
      audit,
    },
  ]
  const returns: RawReturn[] = [
    {
      ...rawHeader({
        id: RETURN_DRAFT,
        document_type: 'sales_return',
        document_date: '2026-10-15',
        source_type: 'sales_invoice',
        source_id: INVOICE_ISSUED,
        subtotal: '300.0000',
        tax_total: '60.0000',
        total: '360.0000',
      }),
      ...returnFields,
      status: 'draft',
      invoice_id: INVOICE_ISSUED,
      reason: 'Hasarlı',
      lines: [
        {
          ...rawLine({
            id: 'rl-1',
            quantity: '3.000000',
            base_quantity: '3.000000',
            gross_amount: '300.0000',
            net_amount: '300.0000',
            tax_amount: '60.0000',
            line_total: '360.0000',
            source_line_id: 'il-1',
          }),
          invoice_line_id: 'il-1',
          delivery_line_id: 'dl-p1',
          lot_no: 'L-B',
          serial_numbers: [],
          unit_cost: null,
          cost_total: null,
        },
        {
          ...rawLine({
            id: 'rl-2',
            line_no: 2,
            item_id: ITEM_SERVICE,
            item_type: 'service',
            quantity: '1.000000',
            unit_price: '0.000000',
            source_line_id: 'il-2',
          }),
          invoice_line_id: 'il-2',
          delivery_line_id: null,
          lot_no: null,
          serial_numbers: [],
          unit_cost: null,
          cost_total: null,
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
        ...rawHeader({
          id: ORDER_1,
          document_type: 'sales_order',
          number: 'ORD2026000000001',
          document_date: '2026-10-01',
        }),
        status: 'confirmed',
        lines: [
          orderLine({
            id: 'ol-1',
            quantity: '10.000000',
            delivered_quantity: '4.000000',
          }),
          orderLine({ id: 'ol-2', line_no: 2, item_id: ITEM_PHONE, quantity: '2.000000' }),
          orderLine({
            id: 'ol-3',
            line_no: 3,
            item_id: ITEM_SERVICE,
            item_type: 'service',
            quantity: '1.000000',
          }),
        ],
      },
    ],
    lots: [
      {
        lot_id: 'lot-b',
        lot_no: 'L-B',
        expiry_date: daysFromToday(40),
        on_hand: '3.000000',
        item_id: ITEM_BOLT,
        warehouse_id: WH_MAIN,
      },
      {
        lot_id: 'lot-a',
        lot_no: 'L-A',
        expiry_date: daysFromToday(20),
        on_hand: '2.000000',
        item_id: ITEM_BOLT,
        warehouse_id: WH_MAIN,
      },
      {
        lot_id: 'lot-x',
        lot_no: 'L-X',
        expiry_date: daysFromToday(-3),
        on_hand: '9.000000',
        item_id: ITEM_BOLT,
        warehouse_id: WH_MAIN,
      },
      {
        lot_id: 'lot-n',
        lot_no: 'L-N',
        expiry_date: null,
        on_hand: '50.000000',
        item_id: ITEM_BOLT,
        warehouse_id: WH_MAIN,
      },
    ],
    exposure: {
      [PARTY_ACME]: {
        party_id: PARTY_ACME,
        limit: '2000.00',
        currency: 'TRY',
        open_invoices: '1200.00',
        open_orders: '300.00',
        total: '1500.00',
        available: '500.00',
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

function error(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[]>,
  details?: Record<string, unknown>,
) {
  return HttpResponse.json(
    { errors: { message, code, ...(fields ? { fields } : {}), ...(details ? { details } : {}) } },
    { status },
  )
}
const validation = (fields: Record<string, string[]>) =>
  error(422, 'VALIDATION_ERROR', Object.values(fields)[0]?.[0] ?? 'Geçersiz.', fields)
const notFound = () => error(404, 'NOT_FOUND', 'Kayıt bulunamadı.')
const conflict = () =>
  error(409, 'VERSION_CONFLICT', 'Kayıt siz düzenlerken başka biri tarafından değiştirildi.')
const transition = () => error(422, 'INVALID_STATE_TRANSITION', 'Bu durumda işlem yapılamaz.')

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

/** List rows: no lines/links/audit, with line_count. */
const row = <T extends { lines: unknown[]; audit?: unknown }>(d: T) => {
  const out: Partial<T> & { line_count: number } = { ...d, line_count: d.lines.length }
  delete out.lines
  delete out.audit
  return out
}

/** Action and create responses: the document without links/warnings/audit (as respond()). */
const bare = <T extends { audit?: unknown }>(d: T) => {
  const out: Partial<T> = { ...d }
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
    unit_price: price.toFixed(6),
    gross: raw.toDecimalPlaces(2),
    net,
    tax,
    total: net.plus(tax),
  }
}

function link(d: ApiHeader & { status: string; invoice_type?: string }): ApiLink {
  return {
    id: d.id,
    document_type: d.invoice_type === 'return' ? 'sales_credit_note' : d.document_type,
    number: d.number,
    status: d.status,
    document_date: d.document_date,
    total: d.total,
    currency_code: d.currency_code,
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
    return `${prefix}2026${String(db.numberSeq[prefix]).padStart(9, '0')}`
  }
  const newId = (p: string) => `${p}-${++db.seq}`
  const findOrder = (id: string) => db.orders.find((o) => o.id === id)
  const many = (rows: (ApiHeader & { status: string; invoice_type?: string })[]) =>
    [...rows].sort((a, b) => a.document_date.localeCompare(b.document_date)).map(link)
  const one = (d: (ApiHeader & { status: string; invoice_type?: string }) | undefined) =>
    d ? link(d) : null

  /** DocumentLinks::for, computed from the in-memory documents. */
  const linksOf = (doc: RawDelivery | RawInvoice | RawReturn): ApiLinks => {
    if (doc.document_type === 'sales_delivery') {
      const d = doc as RawDelivery
      const ids = new Set(d.lines.map((l) => l.id))
      return {
        order: one(d.order_id ? findOrder(d.order_id) : undefined),
        invoices: many(
          db.invoices.filter((i) =>
            i.lines.some((l) => l.delivery_line_id && ids.has(l.delivery_line_id)),
          ),
        ),
        invoice: one(db.invoices.find((i) => i.id === d.invoice_id)),
      }
    }
    if (doc.document_type === 'sales_invoice') {
      const inv = doc as RawInvoice
      const dl = new Set(inv.lines.map((l) => l.delivery_line_id).filter(Boolean))
      return {
        order: one(inv.order_id ? findOrder(inv.order_id) : undefined),
        deliveries: many(db.deliveries.filter((d) => d.lines.some((l) => dl.has(l.id)))),
        returns: many(db.returns.filter((r) => r.invoice_id === inv.id)),
        credit_notes: many(db.invoices.filter((i) => i.original_invoice_id === inv.id)),
        original_invoice: one(db.invoices.find((i) => i.id === inv.original_invoice_id)),
        return: one(db.returns.find((r) => r.id === inv.return_id)),
      }
    }
    const r = doc as RawReturn
    return {
      invoice: one(db.invoices.find((i) => i.id === r.invoice_id)),
      credit_invoice: one(db.invoices.find((i) => i.id === r.credit_invoice_id)),
    }
  }
  const detail = (doc: RawDelivery | RawInvoice | RawReturn) => ({
    data: { ...doc, links: linksOf(doc), warnings: [], audit: doc.audit ?? [] },
  })

  const filterDocs = <
    T extends { status: string; party_id: string; document_date: string; number: string | null },
  >(
    rows: T[],
    url: URL,
  ) =>
    rows.filter((r) => {
      const f = (k: string) => url.searchParams.get(`filter[${k}]`)
      if (f('status') && !(f('status') ?? '').split(',').includes(r.status)) return false
      if (f('party_id') && r.party_id !== f('party_id')) return false
      if (f('date_from') && r.document_date < (f('date_from') ?? '')) return false
      if (f('date_to') && r.document_date > (f('date_to') ?? '')) return false
      if (f('number') && !(r.number ?? '').includes(f('number') ?? '')) return false
      return true
    })

  const recomputeInvoice = (inv: RawInvoice) => {
    let sub = D(0)
    let disc = D(0)
    let tax = D(0)
    let net = D(0)
    for (const l of inv.lines) {
      const p = priceLine(l)
      l.unit_price = p.unit_price
      l.gross_amount = p.gross.toFixed(4)
      l.line_discount = p.gross.minus(p.net).toFixed(4)
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
    const local = D(inv.total).mul(D(inv.fx_rate)).toDecimalPlaces(2)
    inv.total_local = local.toFixed(4)
    inv.tax_total_local = D(inv.tax_total).mul(D(inv.fx_rate)).toDecimalPlaces(2).toFixed(4)
    inv.discount_total_local = D(inv.discount_total)
      .mul(D(inv.fx_rate))
      .toDecimalPlaces(2)
      .toFixed(4)
    inv.subtotal_local = local
      .minus(D(inv.tax_total_local))
      .plus(D(inv.discount_total_local))
      .toFixed(4)
  }

  interface InvoiceLineBody {
    item_id?: string | null
    description?: string | null
    quantity: string
    unit_id?: string | null
    unit_price?: string | null
    discount_percent?: string | null
    discount_amount?: string | null
    tax_code_id?: string | null
    delivery_line_id?: string | null
    order_line_id?: string | null
  }
  interface InvoiceBody {
    party_id: string
    document_date?: string
    due_date?: string | null
    currency_code?: string | null
    fx_rate?: string | null
    notes?: string | null
    deliver_on_invoice?: boolean
    lines: InvoiceLineBody[]
  }
  const invoiceLines = (id: string, lines: InvoiceLineBody[]): ApiInvoiceLine[] =>
    lines.map((l, i) => {
      const dl = l.delivery_line_id
        ? db.deliveries.flatMap((d) => d.lines).find((x) => x.id === l.delivery_line_id)
        : undefined
      const item = l.item_id ?? dl?.item_id ?? ITEM_BOLT
      const tax = l.tax_code_id === undefined ? TAX_20 : l.tax_code_id
      return invoiceLine({
        id: `${id}-l${i + 1}`,
        line_no: i + 1,
        item_id: item,
        item_type: itemType(item),
        description: l.description ?? null,
        quantity: l.quantity,
        base_quantity: l.quantity,
        unit_id: l.unit_id ?? UNIT_PCS,
        unit_price: l.unit_price ?? '100',
        price_source: l.unit_price ? 'manual' : 'default_price_list',
        discount_percent: l.discount_percent ?? '0',
        discount_amount: l.discount_amount ?? '0',
        tax_code_id: tax,
        tax_rate: tax === TAX_20 ? '20.000000' : '0.000000',
        delivery_line_id: l.delivery_line_id ?? null,
        order_line_id: l.order_line_id ?? dl?.order_line_id ?? null,
      })
    })

  const printModel = (doc: RawDelivery | RawInvoice | RawReturn): PrintModel => {
    const header: Partial<typeof doc> = { ...doc }
    delete header.lines
    delete header.audit
    const taxes = new Map<string, { base: Decimal; tax: Decimal }>()
    for (const l of doc.lines) {
      const t = taxes.get(l.tax_rate) ?? { base: D(0), tax: D(0) }
      taxes.set(l.tax_rate, { base: t.base.plus(l.net_amount), tax: t.tax.plus(l.tax_amount) })
    }
    const credit = 'invoice_type' in doc && doc.invoice_type === 'return'
    return {
      document_type: credit ? 'sales_credit_note' : doc.document_type,
      company: { id: 'company-a', name: 'Anadolu Makina A.Ş.' },
      document: header as PrintModel['document'],
      party: {
        id: doc.party_id,
        name: doc.party_name,
        tax_office: doc.party_tax_office,
        tax_number: doc.party_tax_number,
        billing_address: doc.billing_address,
      },
      lines: doc.lines.map((l) => {
        const item = ITEMS.find((x) => x.id === l.item_id)
        return {
          line_no: l.line_no,
          item_code: item?.code ?? null,
          item_name: item?.name ?? null,
          description: l.description,
          quantity: l.quantity,
          unit_code: 'ADET',
          unit_name: 'Adet',
          unit_price: l.unit_price,
          discount_percent: l.discount_percent,
          discount_amount: l.line_discount,
          net_amount: l.net_amount,
          tax_rate: l.tax_rate,
          tax_amount: l.tax_amount,
          line_total: l.line_total,
          lot_no: 'lot_no' in l ? l.lot_no : null,
          serial_numbers: 'serial_numbers' in l ? (l.serial_numbers ?? []) : [],
        }
      }),
      taxes: [...taxes].map(([rate, t]) => ({
        rate,
        base: t.base.toFixed(2),
        tax: t.tax.toFixed(2),
      })),
      totals: {
        subtotal: doc.subtotal,
        discount_total: doc.discount_total,
        tax_total: doc.tax_total,
        total: doc.total,
        subtotal_local: doc.subtotal_local,
        discount_total_local: doc.discount_total_local,
        tax_total_local: doc.tax_total_local,
        total_local: doc.total_local,
      },
    }
  }

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
    http.get(`${base}/items`, async ({ request }) => {
      const { url } = await record(request)
      const ids = url.searchParams.get('filter[id]')
      const rows = ids ? ITEMS.filter((i) => ids.split(',').includes(i.id)) : ITEMS
      return HttpResponse.json(paginate(rows, url, 100))
    }),
    http.get(`${base}/items/:id`, async ({ request, params }) => {
      await record(request)
      const item = ITEMS.find((i) => i.id === String(params.id))
      if (!item) return notFound()
      return HttpResponse.json({
        data: {
          ...item,
          purchase_tax_code_id: null,
          min_stock: null,
          reorder_point: null,
          attributes: {},
        },
      })
    }),
    http.get(`${base}/stock-balances`, async ({ request }) => {
      const { url } = await record(request)
      if (db.lotsGate) await db.lotsGate
      const item = url.searchParams.get('filter[item_id]')
      const wh = url.searchParams.get('filter[warehouse_id]')
      const rows = db.lots
        .filter((l) => l.item_id === item && (!wh || l.warehouse_id === wh))
        .map((l) => ({
          item_id: l.item_id,
          warehouse_id: l.warehouse_id,
          location_id: null,
          lot_id: l.lot_id,
          lot_no: l.lot_no,
          expiry_date: l.expiry_date,
          on_hand: l.on_hand,
          reserved: '0.000000',
          available: l.on_hand,
        }))
      return HttpResponse.json(paginate(rows, url, 100))
    }),

    // ---- Orders (read by the delivery editor) ----
    http.get(`${base}/sales-orders/:id`, async ({ request, params }) => {
      await record(request)
      const o = findOrder(String(params.id))
      return o
        ? HttpResponse.json({ data: { ...o, links: {}, warnings: [], audit: [] } })
        : notFound()
    }),

    // ---- Deliveries ----
    http.get(`${base}/sales-deliveries`, async ({ request }) => {
      const { url } = await record(request)
      return HttpResponse.json(paginate(filterDocs(db.deliveries, url).map(row), url))
    }),
    http.get(`${base}/sales-deliveries/:id/print-model`, async ({ request, params }) => {
      await record(request)
      const d = db.deliveries.find((x) => x.id === params.id)
      return d ? HttpResponse.json({ data: printModel(d) }) : notFound()
    }),
    http.get(`${base}/sales-deliveries/:id`, async ({ request, params }) => {
      await record(request)
      const d = db.deliveries.find((x) => x.id === params.id)
      return d ? HttpResponse.json(detail(d)) : notFound()
    }),
    http.post(`${base}/sales-orders/:id/deliveries`, async ({ request, params }) => {
      const { body, failed } = await record(request)
      if (failed) return HttpResponse.error()
      const o = findOrder(String(params.id))
      if (!o) return notFound()
      const b = body as {
        document_date?: string
        warehouse_id?: string | null
        notes?: string | null
        lines: {
          order_line_id: string
          quantity: string
          lot_no?: string | null
          serial_numbers?: string[]
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
            return validation({
              [`lines.${i}.quantity`]: [`Kalan miktar ${remaining.toString()}.`],
            })
        }
        const id = newId('delivery')
        const d: RawDelivery = {
          ...rawHeader({
            id,
            document_type: 'sales_delivery',
            document_date: b.document_date ?? toIsoDate(new Date()),
            warehouse_id: b.warehouse_id ?? o.warehouse_id,
            notes: b.notes ?? null,
            source_type: 'sales_order',
            source_id: o.id,
          }),
          ...deliveryFields,
          order_id: o.id,
          status: 'draft',
          lines: b.lines.map((l, i) => {
            const ol = o.lines.find((x) => x.id === l.order_line_id)
            return deliveryLine({
              id: `${id}-l${i + 1}`,
              line_no: i + 1,
              item_id: ol?.item_id ?? '',
              quantity: l.quantity,
              base_quantity: l.quantity,
              lot_no: l.lot_no ?? null,
              serial_numbers: l.serial_numbers ?? [],
              order_line_id: l.order_line_id,
              source_line_id: l.order_line_id,
            })
          }),
        }
        db.deliveries.push(d)
        return { status: 201, body: { data: bare(d) } }
      })
    }),
    http.post(`${base}/sales-deliveries`, async ({ request }) => {
      const { body } = await record(request)
      const b = body as {
        party_id: string
        document_date?: string
        warehouse_id?: string | null
        notes?: string | null
        lines: {
          item_id: string
          unit_id?: string
          quantity: string
          lot_no?: string | null
          serial_numbers?: string[]
        }[]
      }
      return idempotent(request, b, () => {
        const id = newId('delivery')
        const d: RawDelivery = {
          ...rawHeader({
            id,
            document_type: 'sales_delivery',
            party_id: b.party_id,
            document_date: b.document_date ?? toIsoDate(new Date()),
            warehouse_id: b.warehouse_id ?? WH_MAIN,
            notes: b.notes ?? null,
          }),
          ...deliveryFields,
          order_id: null,
          status: 'draft',
          lines: b.lines.map((l, i) =>
            deliveryLine({
              id: `${id}-l${i + 1}`,
              line_no: i + 1,
              item_id: l.item_id,
              quantity: l.quantity,
              base_quantity: l.quantity,
              lot_no: l.lot_no ?? null,
              serial_numbers: l.serial_numbers ?? [],
              order_line_id: null,
            }),
          ),
        }
        db.deliveries.push(d)
        return { status: 201, body: { data: bare(d) } }
      })
    }),
    http.patch(`${base}/sales-deliveries/:id`, async ({ request, params }) => {
      const { body } = await record(request)
      const d = db.deliveries.find((x) => x.id === params.id)
      if (!d) return notFound()
      const b = body as {
        version?: number
        document_date?: string
        warehouse_id?: string | null
        notes?: string | null
        lines?: {
          order_line_id?: string | null
          item_id: string
          quantity: string
          lot_no?: string | null
          serial_numbers?: string[]
        }[]
      }
      if (b.version === undefined) return validation({ version: ['Sürüm gerekli.'] })
      if (b.version !== d.version) return conflict()
      if (d.status !== 'draft') return transition()
      if (b.document_date) d.document_date = b.document_date
      if (b.warehouse_id !== undefined) d.warehouse_id = b.warehouse_id
      if (b.notes !== undefined) d.notes = b.notes
      if (b.lines)
        d.lines = b.lines.map((l, i) =>
          deliveryLine({
            id: `${d.id}-l${i + 1}`,
            line_no: i + 1,
            item_id: l.item_id,
            quantity: l.quantity,
            base_quantity: l.quantity,
            lot_no: l.lot_no ?? null,
            serial_numbers: l.serial_numbers ?? [],
            order_line_id: l.order_line_id ?? null,
            source_line_id: l.order_line_id ?? null,
          }),
        )
      d.version++
      return HttpResponse.json({ data: bare(d) })
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
      const b = (body ?? {}) as { version?: number }
      return idempotent(request, { path, ...b }, () => {
        if (d.status === 'posted')
          return { status: 200, body: { data: bare(d), meta: { replayed: true } } }
        if (b.version !== undefined && b.version !== d.version) return conflict()
        if (d.status !== 'draft') return transition()
        d.status = 'posted'
        d.number = nextNumber('DLV')
        d.posted_at = '2026-10-21T10:00:00Z'
        d.stock_document_id = 'stock-doc-new'
        d.journal_entry_id = 'je-cogs-new'
        d.version++
        return { status: 200, body: { data: bare(d) } }
      })
    }),
    http.post(`${base}/sales-deliveries/:id/cancel`, async ({ request, params }) => {
      const { body, path } = await record(request)
      const d = db.deliveries.find((x) => x.id === params.id)
      if (!d) return notFound()
      const b = (body ?? {}) as { version?: number; reason?: string; date?: string }
      return idempotent(request, { path, ...b }, () => {
        if (b.version !== undefined && b.version !== d.version) return conflict()
        if (d.status === 'posted' && !b.reason?.trim())
          return validation({ reason: ['Neden gerekli.'] })
        if (d.status === 'cancelled') return transition()
        d.status = 'cancelled'
        d.cancel_reason = b.reason ?? null
        d.version++
        return { status: 200, body: { data: bare(d) } }
      })
    }),
    http.post(`${base}/sales-deliveries/:id/invoice`, async ({ request, params }) => {
      const { body, path } = await record(request)
      const d = db.deliveries.find((x) => x.id === params.id)
      if (!d) return notFound()
      const b = (body ?? {}) as {
        document_date?: string
        lines?: { delivery_line_id: string; quantity: string }[]
      }
      return idempotent(request, { path, body }, () => {
        if (d.status !== 'posted') return transition()
        const id = newId('invoice')
        const picked =
          b.lines ?? d.lines.map((l) => ({ delivery_line_id: l.id, quantity: l.quantity }))
        const inv: RawInvoice = {
          ...rawHeader({
            id,
            document_type: 'sales_invoice',
            party_id: d.party_id,
            document_date: b.document_date ?? toIsoDate(new Date()),
            source_type: 'sales_delivery',
            source_id: d.id,
          }),
          ...invoiceFields,
          order_id: d.order_id,
          delivery_id: d.id,
          status: 'draft',
          lines: invoiceLines(id, picked),
        }
        recomputeInvoice(inv)
        db.invoices.push(inv)
        return { status: 201, body: { data: bare(inv) } }
      })
    }),

    // ---- Invoices ----
    http.get(`${base}/sales-invoices`, async ({ request }) => {
      const { url } = await record(request)
      let rows = filterDocs(db.invoices, url)
      const type = url.searchParams.get('filter[invoice_type]')
      if (type) rows = rows.filter((r) => r.invoice_type === type)
      if (url.searchParams.get('filter[open]') === '1')
        rows = rows.filter(
          (r) => ['issued', 'partially_paid'].includes(r.status) && D(r.balance_due).greaterThan(0),
        )
      return HttpResponse.json(paginate(rows.map(row), url))
    }),
    http.get(`${base}/sales-invoices/:id/print-model`, async ({ request, params }) => {
      await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      return inv ? HttpResponse.json({ data: printModel(inv) }) : notFound()
    }),
    http.get(`${base}/sales-invoices/:id`, async ({ request, params }) => {
      await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      return inv ? HttpResponse.json(detail(inv)) : notFound()
    }),
    http.post(`${base}/sales-invoices`, async ({ request }) => {
      const { body } = await record(request)
      const b = body as InvoiceBody
      return idempotent(request, b, () => {
        if (b.lines.length === 0) return validation({ lines: ['En az bir satır gerekli.'] })
        for (const [i, l] of b.lines.entries())
          if (!l.item_id && !l.delivery_line_id && !l.order_line_id)
            return validation({ [`lines.${i}.item_id`]: ['Stok kartı gerekli.'] })
        const id = newId('invoice')
        const inv: RawInvoice = {
          ...rawHeader({
            id,
            document_type: 'sales_invoice',
            party_id: b.party_id,
            document_date: b.document_date ?? toIsoDate(new Date()),
            due_date: b.due_date ?? null,
            currency_code: b.currency_code ?? 'TRY',
            fx_rate: b.fx_rate ?? '1.000000',
            notes: b.notes ?? null,
          }),
          ...invoiceFields,
          deliver_on_invoice: b.deliver_on_invoice ?? false,
          status: 'draft',
          lines: invoiceLines(id, b.lines),
        }
        recomputeInvoice(inv)
        db.invoices.push(inv)
        return { status: 201, body: { data: bare(inv) } }
      })
    }),
    http.patch(`${base}/sales-invoices/:id`, async ({ request, params }) => {
      const { body } = await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      if (!inv) return notFound()
      const b = body as Partial<InvoiceBody> & { version?: number }
      if (b.version === undefined) return validation({ version: ['Sürüm gerekli.'] })
      if (b.version !== inv.version) return conflict()
      if (inv.status !== 'draft') return transition()
      if (b.document_date) inv.document_date = b.document_date
      if (b.due_date !== undefined) inv.due_date = b.due_date
      if (b.notes !== undefined) inv.notes = b.notes
      if (b.lines) inv.lines = invoiceLines(inv.id, b.lines)
      recomputeInvoice(inv)
      inv.version++
      return HttpResponse.json({ data: bare(inv) })
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
      const b = (body ?? {}) as { version?: number; credit_override_reason?: string }
      return idempotent(request, { path, ...b }, () => {
        if (['issued', 'partially_paid', 'paid'].includes(inv.status))
          return { status: 200, body: { data: bare(inv), meta: { replayed: true } } }
        if (b.version !== undefined && b.version !== inv.version) return conflict()
        if (inv.status !== 'draft') return transition()
        const e = db.exposure[inv.party_id]
        const over = e?.available != null && D(inv.total_local).greaterThan(D(e.available))
        const warnings: { code: string; message: string; details?: unknown }[] = []
        const check = e
          ? {
              mode: db.creditMode,
              limit: e.limit,
              currency: e.currency,
              exposure: e.total,
              document: D(inv.total_local).toFixed(2),
              total: D(e.total).plus(D(inv.total_local)).toFixed(2),
              available:
                e.limit === null
                  ? null
                  : D(e.limit).minus(D(e.total)).minus(D(inv.total_local)).toFixed(2),
              exceeded: over,
              overridden: false,
            }
          : null
        if (over && db.creditMode === 'block') {
          const allowed =
            !!b.credit_override_reason?.trim() && db.permissions.includes('sales.credit_override')
          if (!allowed)
            return error(
              422,
              'sales.credit_limit_exceeded',
              'Müşterinin risk limiti aşılıyor.',
              { party_id: ['Müşterinin risk limiti aşılıyor.'] },
              check ?? undefined,
            )
          warnings.push({
            code: 'sales.credit_limit_exceeded',
            message: 'Risk limiti aşıldı; yetkiyle onaylandı.',
            details: { ...check, overridden: true },
          })
          inv.credit_override_reason = b.credit_override_reason ?? null
        }
        if (over && db.creditMode === 'warn')
          warnings.push({
            code: 'sales.credit_limit_exceeded',
            message: 'Risk limiti aşıldı (uyarı).',
            details: check,
          })
        inv.status = 'issued'
        inv.number = nextNumber('INV')
        inv.issued_at = '2026-10-21T10:00:00Z'
        inv.journal_entry_id = 'je-new'
        inv.balance_due = inv.total
        inv.version++
        return {
          status: 200,
          body: { data: bare(inv), ...(warnings.length > 0 ? { meta: { warnings } } : {}) },
        }
      })
    }),
    http.post(`${base}/sales-invoices/:id/reverse`, async ({ request, params }) => {
      const { body, path } = await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      if (!inv) return notFound()
      const b = (body ?? {}) as {
        version?: number
        date?: string
        reason?: string
        reverse_stock?: boolean
      }
      return idempotent(request, { path, ...b }, () => {
        if (inv.status === 'reversed')
          return { status: 200, body: { data: bare(inv), meta: { replayed: true } } }
        if (b.version !== undefined && b.version !== inv.version) return conflict()
        if (!b.reason?.trim()) return validation({ reason: ['Neden gerekli.'] })
        if (inv.status !== 'issued') return transition()
        inv.status = 'reversed'
        inv.reversal_reason = b.reason
        inv.reversal_date = b.date ?? toIsoDate(new Date())
        inv.reversal_journal_entry_id = 'je-rev'
        inv.balance_due = '0.0000'
        inv.version++
        return { status: 200, body: { data: bare(inv) } }
      })
    }),
    http.post(`${base}/sales-documents/preview-totals`, async ({ request }) => {
      const { body } = await record(request)
      const b = body as InvoiceBody & {
        payment_term_id?: string | null
        warehouse_id?: string | null
      }
      if (b.lines.length === 0) return validation({ lines: ['En az bir satır gerekli.'] })
      for (const [i, l] of b.lines.entries())
        if (!l.item_id) return validation({ [`lines.${i}.item_id`]: ['Stok kartı gerekli.'] })
      let sub = D(0)
      let disc = D(0)
      let tax = D(0)
      let net = D(0)
      const taxes = new Map<string, { base: Decimal; tax: Decimal }>()
      const lines = b.lines.map((l) => {
        const taxCode = l.tax_code_id === undefined ? TAX_20 : l.tax_code_id
        const rate = taxCode === TAX_20 ? '20.000000' : '0.000000'
        const p = priceLine({
          quantity: l.quantity,
          unit_price: l.unit_price ?? null,
          discount_percent: l.discount_percent ?? '0',
          discount_amount: l.discount_amount ?? '0',
          tax_rate: rate,
        })
        sub = sub.plus(p.gross)
        disc = disc.plus(p.gross.minus(p.net))
        tax = tax.plus(p.tax)
        net = net.plus(p.net)
        const tl = taxes.get(taxCode ?? '') ?? { base: D(0), tax: D(0) }
        taxes.set(taxCode ?? '', { base: tl.base.plus(p.net), tax: tl.tax.plus(p.tax) })
        return {
          item_id: l.item_id,
          quantity: l.quantity,
          unit_id: l.unit_id ?? UNIT_PCS,
          unit_price: p.unit_price,
          price_source: l.unit_price ? 'manual' : 'default_price_list',
          tax_code_id: taxCode,
          tax_rate: rate,
          gross_amount: p.gross.toFixed(2),
          line_discount: p.gross.minus(p.net).toFixed(2),
          net_amount: p.net.toFixed(2),
          tax_amount: p.tax.toFixed(2),
          line_total: p.total.toFixed(2),
          pricing: null,
        }
      })
      const total = net.plus(tax)
      return HttpResponse.json({
        data: {
          header: { party_id: b.party_id, currency_code: b.currency_code ?? 'TRY', fx_rate: '1' },
          lines,
          taxes: [...taxes].map(([id, t]) => ({
            tax_code_id: id || null,
            rate: id === TAX_20 ? '20.000000' : '0.000000',
            base: t.base.toFixed(2),
            tax: t.tax.toFixed(2),
            base_local: t.base.toFixed(2),
            tax_local: t.tax.toFixed(2),
          })),
          totals: {
            subtotal: sub.toFixed(2),
            discount_total: disc.toFixed(2),
            tax_total: tax.toFixed(2),
            total: total.toFixed(2),
            subtotal_local: sub.toFixed(2),
            discount_total_local: disc.toFixed(2),
            tax_total_local: tax.toFixed(2),
            total_local: total.toFixed(2),
          },
          price_overrides: [],
        },
      })
    }),

    // ---- Customers ----
    http.get(`${base}/customers/:id/exposure`, async ({ request, params }) => {
      const { url } = await record(request)
      const e = db.exposure[String(params.id)]
      if (!e) return notFound()
      const documentId = url.searchParams.get('document_id')
      let documentAmount: string | null = null
      if (documentId) {
        const inv = db.invoices.find((i) => i.id === documentId && i.party_id === String(params.id))
        if (inv?.invoice_type !== 'sale') return validation({ document_id: ['Belge bulunamadı.'] })
        // Converted to the risk currency at the day's rate (EUR 35 TRY here).
        documentAmount = (
          e.currency === 'TRY' ? D(inv.total_local) : D(inv.total_local).div(35)
        ).toFixed(2)
      }
      return HttpResponse.json({ data: { ...e, document_amount: documentAmount } })
    }),
    http.get(`${base}/customers/:id/sales-summary`, async ({ request, params }) => {
      await record(request)
      const s = db.summary[String(params.id)]
      return s ? HttpResponse.json({ data: s }) : notFound()
    }),

    // ---- Returns ----
    http.get(`${base}/sales-returns`, async ({ request }) => {
      const { url } = await record(request)
      return HttpResponse.json(paginate(filterDocs(db.returns, url).map(row), url))
    }),
    http.get(`${base}/sales-returns/:id/print-model`, async ({ request, params }) => {
      await record(request)
      const r = db.returns.find((x) => x.id === params.id)
      return r ? HttpResponse.json({ data: printModel(r) }) : notFound()
    }),
    http.get(`${base}/sales-returns/:id`, async ({ request, params }) => {
      await record(request)
      const r = db.returns.find((x) => x.id === params.id)
      return r ? HttpResponse.json(detail(r)) : notFound()
    }),
    http.post(`${base}/sales-invoices/:id/returns`, async ({ request, params }) => {
      const { body } = await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      if (!inv) return notFound()
      const b = body as {
        document_date?: string
        warehouse_id?: string | null
        reason?: string | null
        notes?: string | null
        lines: {
          invoice_line_id: string
          quantity: string
          lot_no?: string | null
          serial_numbers?: string[]
        }[]
      }
      return idempotent(request, { invoice: inv.id, ...b }, () => {
        const held = (lineId: string) =>
          db.returns
            .filter((r) => r.invoice_id === inv.id && r.status !== 'cancelled')
            .flatMap((r) => r.lines)
            .filter((l) => l.invoice_line_id === lineId)
            .reduce((a, l) => a.plus(D(l.quantity)), D(0))
        for (const [i, l] of b.lines.entries()) {
          const il = inv.lines.find((x) => x.id === l.invoice_line_id)
          if (!il) return validation({ [`lines.${i}.invoice_line_id`]: ['Fatura satırı yok.'] })
          const left = D(il.quantity).minus(held(il.id))
          if (D(l.quantity).greaterThan(left))
            return validation({
              [`lines.${i}.quantity`]: [`İade edilebilir miktar ${left.toString()}.`],
            })
        }
        const id = newId('return')
        const lines: ApiReturnLine[] = b.lines.map((l, i) => {
          const il = inv.lines.find((x) => x.id === l.invoice_line_id)
          const p = priceLine({
            quantity: l.quantity,
            unit_price: il?.unit_price ?? '0',
            discount_percent: il?.discount_percent ?? '0',
            discount_amount: '0',
            tax_rate: il?.tax_rate ?? '0',
          })
          return {
            ...rawLine({
              id: `${id}-l${i + 1}`,
              line_no: i + 1,
              item_id: il?.item_id ?? ITEM_BOLT,
              item_type: il?.item_type ?? 'stock',
              description: il?.description ?? null,
              quantity: l.quantity,
              base_quantity: l.quantity,
              unit_price: il?.unit_price ?? '0',
              tax_code_id: il?.tax_code_id ?? null,
              tax_rate: il?.tax_rate ?? '0',
              gross_amount: p.gross.toFixed(4),
              net_amount: p.net.toFixed(4),
              tax_amount: p.tax.toFixed(4),
              line_total: p.total.toFixed(4),
              source_line_id: l.invoice_line_id,
            }),
            invoice_line_id: l.invoice_line_id,
            delivery_line_id: il?.delivery_line_id ?? null,
            lot_no: l.lot_no ?? null,
            serial_numbers: l.serial_numbers ?? [],
            unit_cost: null,
            cost_total: null,
          }
        })
        const total = lines.reduce((a, l) => a.plus(D(l.line_total)), D(0)).toFixed(4)
        const r: RawReturn = {
          ...rawHeader({
            id,
            document_type: 'sales_return',
            party_id: inv.party_id,
            document_date: b.document_date ?? toIsoDate(new Date()),
            warehouse_id: b.warehouse_id ?? inv.warehouse_id,
            notes: b.notes ?? null,
            source_type: 'sales_invoice',
            source_id: inv.id,
            total,
            total_local: total,
          }),
          ...returnFields,
          status: 'draft',
          invoice_id: inv.id,
          reason: b.reason ?? null,
          lines,
        }
        db.returns.push(r)
        return { status: 201, body: { data: bare(r) } }
      })
    }),
    http.post(`${base}/sales-returns/:id/:action`, async ({ request, params }) => {
      const { body, path } = await record(request)
      const r = db.returns.find((x) => x.id === params.id)
      if (!r) return notFound()
      const b = (body ?? {}) as { version?: number }
      const action = String(params.action)
      return idempotent(request, { path, ...b }, () => {
        if (b.version !== undefined && b.version !== r.version) return conflict()
        const next: Record<string, [string, RawReturn['status']]> = {
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
          if (action === 'approve') r.number = nextNumber('RET')
          if (action === 'receive') {
            r.received_at = '2026-10-21T11:00:00Z'
            r.stock_document_id = 'stock-doc-ret'
          }
          if (action === 'credit') {
            const credit: RawInvoice = {
              ...rawHeader({
                id: 'invoice-credit',
                document_type: 'sales_invoice',
                number: nextNumber('CRN'),
                party_id: r.party_id,
                total: r.total,
                total_local: r.total_local,
              }),
              ...invoiceFields,
              invoice_type: 'return',
              status: 'issued',
              return_id: r.id,
              original_invoice_id: r.invoice_id,
              balance_due: r.total,
              lines: [],
            }
            db.invoices.push(credit)
            r.credit_invoice_id = credit.id
          }
        }
        r.version++
        return { status: 200, body: { data: bare(r) } }
      })
    }),
    http.delete(`${base}/sales-returns/:id`, async ({ request, params }) => {
      const { url } = await record(request)
      const r = db.returns.find((x) => x.id === params.id)
      if (!r) return notFound()
      const v = url.searchParams.get('version')
      if (v !== null && Number(v) !== r.version) return conflict()
      db.returns = db.returns.filter((x) => x !== r)
      return new HttpResponse(null, { status: 204 })
    }),

    // ---- Reports ----
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
