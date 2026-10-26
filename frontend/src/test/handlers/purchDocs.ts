import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import type {
  ApiHeader,
  ApiLine,
  ApiLink,
  PrintModel,
  SupplierExposure,
  SupplierPerformance,
  SupplierPurchaseSummaryData,
} from '@/features/purchasing/invoices/kit/types'
import type { ApiInvoiceLine, RawInvoice } from '@/features/purchasing/invoices/types'
import type { ApiReceiptLine, RawOrder, RawReceipt } from '@/features/purchasing/receipts/types'
import type { RawReturn } from '@/features/purchasing/returns/types'

// In-memory stand-in for the Purchasing receipt, invoice, return, supplier and report endpoints
// with the real wire shapes (DocumentResource/LineResource/DocumentLinks/PrintModel, the match
// breakdown and the 422 purchasing.match_failed envelope), plus the read-only lookups the screens
// use. Errors use the envelope {errors: {message, code, fields?, details?}}.

export const SUPPLIER = 'party-sup'
export const ITEM_BOLT = 'item-bolt'
export const ITEM_PHONE = 'item-phone'
export const ITEM_SERVICE = 'item-service'
export const UNIT_PCS = 'unit-pcs'
export const TAX_20 = 'tax-20'
export const WHT_510 = 'wht-510'
export const WH_MAIN = 'wh-main'
export const ORDER_1 = 'order-1'
export const RECEIPT_DRAFT = 'receipt-draft'
export const RECEIPT_POSTED = 'receipt-posted'
export const INVOICE_DRAFT = 'invoice-draft'
export const INVOICE_BOOKED = 'invoice-booked'
export const RETURN_DRAFT = 'return-draft'

const D = (v: string | number) => new Decimal(v)

export interface PurchCall {
  method: string
  path: string
  body: unknown
  url: URL
  headers: Headers
}

export interface PurchDocsDb {
  orders: RawOrder[]
  receipts: RawReceipt[]
  invoices: RawInvoice[]
  returns: RawReturn[]
  /** Raw match payload per invoice id (GET /match and the book check). */
  match: Record<string, Record<string, unknown>>
  matchMode: 'off' | 'warn' | 'block'
  allowDirectReceipt: boolean
  /** Permissions the API checks itself (match override, price override). */
  permissions: string[]
  summary: Record<string, SupplierPurchaseSummaryData>
  performance: Record<string, SupplierPerformance>
  exposure: Record<string, SupplierExposure>
  reports: Record<string, { rows: Record<string, unknown>[]; meta?: Record<string, unknown> }>
  /** Paths whose next N calls fail at the network level (lost response). */
  failNext: Record<string, number>
  /** Paths whose next N calls are committed (idempotency recorded) and then lose the response. */
  failAfterCommit: Record<string, number>
  calls: PurchCall[]
  idempotency: Map<string, { body: string; response: unknown; status: number }>
  seq: number
  numberSeq: Record<string, number>
}

const ITEMS = [
  {
    id: ITEM_BOLT,
    code: 'BOLT',
    name: 'Cıvata M8',
    type: 'stock',
    base_unit_id: UNIT_PCS,
    category_id: 'cat-1',
    default_tax_code_id: TAX_20,
    purchase_tax_code_id: TAX_20,
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
    purchase_tax_code_id: TAX_20,
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
    purchase_tax_code_id: TAX_20,
    tracking: 'none',
    has_expiry: false,
    is_active: true,
    version: 1,
  },
]

const itemType = (id: string) => (id === ITEM_SERVICE ? 'service' : 'stock')

const audit = [
  {
    event: 'created',
    description: 'created',
    causer_id: 'u1',
    properties: null,
    created_at: '2026-10-01T08:00:00Z',
  },
]

function header(over: Partial<ApiHeader> & Pick<ApiHeader, 'id' | 'document_type'>): ApiHeader {
  return {
    number: null,
    status: 'draft',
    document_date: '2026-10-10',
    party_id: SUPPLIER,
    party_name: 'Tedarik Ltd.',
    party_tax_office: 'Kartal',
    party_tax_number: '9876543210',
    billing_address: { line1: 'Sanayi Cd. 5', city: 'İstanbul' },
    currency_code: 'TRY',
    fx_rate: '1.000000',
    payment_term_id: null,
    due_date: null,
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
    withholding_total: '0.0000',
    subtotal_local: '0.0000',
    discount_total_local: '0.0000',
    tax_total_local: '0.0000',
    total_local: '0.0000',
    withholding_total_local: '0.0000',
    version: 1,
    created_by: 'u1',
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z',
    ...over,
  }
}

/** A priced line the way the API computes it (per-line rounding, withholding of the VAT). */
function line(over: Partial<ApiLine> & Pick<ApiLine, 'id'>): ApiLine {
  const qty = over.quantity ?? '1.000000'
  const price = over.unit_price ?? '0.000000'
  const taxRate = over.tax_code_id === null ? '0' : (over.tax_rate ?? '20.000000')
  const wRate = over.withholding_rate ?? '0.0000'
  const net = D(qty).mul(D(price)).toDecimalPlaces(2)
  const tax = net.mul(D(taxRate)).div(100).toDecimalPlaces(2)
  const w = tax.mul(D(wRate)).div(100).toDecimalPlaces(2)
  return {
    line_no: 1,
    item_id: ITEM_BOLT,
    variant_id: null,
    item_type: itemType(over.item_id ?? ITEM_BOLT),
    description: null,
    unit_id: UNIT_PCS,
    base_quantity: qty,
    tax_inclusive: false,
    discount_percent: '0.0000',
    discount_amount: '0.0000',
    gross_amount: net.toFixed(4),
    line_discount: '0.0000',
    net_amount: net.toFixed(4),
    tax_code_id: TAX_20,
    tax_amount: tax.toFixed(4),
    withholding_code_id: null,
    withholding_amount: w.toFixed(4),
    line_total: net.plus(tax).toFixed(4),
    warehouse_id: null,
    source_line_id: null,
    price_source: 'manual',
    ...over,
    quantity: qty,
    unit_price: price,
    tax_rate: taxRate,
    withholding_rate: wRate,
  }
}

/** Header totals from the lines (both currencies; fx 1 in the fixtures). */
function totals(lines: readonly ApiLine[]) {
  const sum = (k: keyof ApiLine) =>
    lines.reduce((a, l) => a.plus(D(l[k] as string)), D(0)).toFixed(4)
  const t = {
    subtotal: sum('net_amount'),
    discount_total: '0.0000',
    tax_total: sum('tax_amount'),
    total: sum('line_total'),
    withholding_total: sum('withholding_amount'),
  }
  return {
    ...t,
    subtotal_local: t.subtotal,
    discount_total_local: t.discount_total,
    tax_total_local: t.tax_total,
    total_local: t.total,
    withholding_total_local: t.withholding_total,
  }
}

const receiptFields = {
  order_id: null,
  invoice_id: null,
  supplier_reference: null,
  stock_document_id: null,
  journal_entry_id: null,
  cost_total: '0.0000',
  posted_at: null,
  posted_by: null,
  cancelled_at: null,
  cancel_reason: null,
  reversal_stock_document_id: null,
  reversal_date: null,
}

const invoiceFields = {
  invoice_type: 'purchase' as const,
  supplier_invoice_no: null,
  order_id: null,
  receipt_id: null,
  return_id: null,
  original_invoice_id: null,
  receive_on_invoice: false,
  journal_entry_id: null,
  reversal_journal_entry_id: null,
  payable_total: '0.0000',
  paid_amount: '0.0000',
  balance_due: '0.0000',
  match_status: null,
  match_override_reason: null,
  match_override_by: null,
  approval_request_id: null,
  approval_comment: null,
  approved_at: null,
  booked_at: null,
  booked_by: null,
  reversed_at: null,
  reversal_date: null,
  reversal_reason: null,
  e_document_status: null,
  e_document_uuid: null,
}

function receiptLine(over: Partial<ApiReceiptLine> & Pick<ApiReceiptLine, 'id'>): ApiReceiptLine {
  return {
    ...line({ unit_price: '50.000000', ...over }),
    order_line_id: null,
    lot_no: null,
    expiry_date: null,
    serial_numbers: [],
    location_id: null,
    unit_cost: null,
    cost_total: null,
    ...over,
  }
}

function invoiceLine(over: Partial<ApiInvoiceLine> & Pick<ApiInvoiceLine, 'id'>): ApiInvoiceLine {
  return {
    ...line(over),
    order_line_id: null,
    receipt_line_id: null,
    original_line_id: null,
    match_status: null,
    match_details: null,
    net_local: '0.0000',
    grni_amount: '0.0000',
    variance_amount: '0.0000',
    expense_amount: '0.0000',
    ...over,
  }
}

function withTotals<T extends { lines: ApiLine[] }>(doc: T): T {
  return { ...doc, ...totals(doc.lines) }
}

function matchFor(inv: RawInvoice, orders: RawOrder[]): Record<string, unknown> {
  const orderLines = orders.flatMap((o) => o.lines)
  let worst = 'matched'
  const weight: Record<string, number> = {
    matched: 0,
    unmatched: 1,
    price_variance: 2,
    qty_variance: 3,
  }
  const lines = inv.lines.map((l) => {
    const ol = orderLines.find((x) => x.id === l.order_line_id)
    if (!ol) {
      if ((weight.unmatched ?? 0) > (weight[worst] ?? 0)) worst = 'unmatched'
      return { invoice_line_id: l.id, status: 'unmatched', line_no: l.line_no, reason: 'no_order' }
    }
    const diff = D(ol.unit_price).isZero()
      ? D(0)
      : D(l.unit_price)
          .minus(D(ol.unit_price))
          .abs()
          .mul(100)
          .div(D(ol.unit_price))
          .toDecimalPlaces(4)
    const invoiced = D(ol.invoiced_quantity).plus(D(l.quantity))
    const reference = l.receipt_line_id ? D(ol.received_quantity) : D(ol.quantity)
    const status = invoiced.greaterThan(reference)
      ? 'qty_variance'
      : diff.greaterThan(0)
        ? 'price_variance'
        : 'matched'
    if ((weight[status] ?? 0) > (weight[worst] ?? 0)) worst = status
    return {
      invoice_line_id: l.id,
      status,
      line_no: l.line_no,
      order_line_id: ol.id,
      ordered: D(ol.quantity).toString(),
      received: D(ol.received_quantity).toString(),
      invoiced: invoiced.toString(),
      reference: reference.toString(),
      order_price: ol.unit_price,
      invoice_price: l.unit_price,
      price_difference_percent: diff.toFixed(4),
      qty_tolerance_percent: '0',
      price_tolerance_percent: '0',
    }
  })
  return { status: worst, lines }
}

export function createPurchDocsDb(overrides: Partial<PurchDocsDb> = {}): PurchDocsDb {
  const order: RawOrder = {
    id: ORDER_1,
    number: 'POR2026000000001',
    status: 'partially_received',
    party_id: SUPPLIER,
    party_name: 'Tedarik Ltd.',
    warehouse_id: WH_MAIN,
    currency_code: 'TRY',
    document_date: '2026-10-01',
    lines: [
      {
        ...line({
          id: 'ol-bolt',
          line_no: 1,
          item_id: ITEM_BOLT,
          quantity: '10.000000',
          unit_price: '50.000000',
        }),
        received_quantity: '4.000000',
        invoiced_quantity: '0.000000',
        expected_date: '2026-10-05',
      },
      {
        ...line({
          id: 'ol-phone',
          line_no: 2,
          item_id: ITEM_PHONE,
          quantity: '2.000000',
          unit_price: '1000.000000',
        }),
        received_quantity: '0.000000',
        invoiced_quantity: '0.000000',
        expected_date: '2026-10-05',
      },
      {
        ...line({
          id: 'ol-srv',
          line_no: 3,
          item_id: ITEM_SERVICE,
          quantity: '1.000000',
          unit_price: '300.000000',
        }),
        received_quantity: '0.000000',
        invoiced_quantity: '0.000000',
        expected_date: null,
      },
    ],
  }
  const receiptDraft = withTotals({
    ...header({
      id: RECEIPT_DRAFT,
      document_type: 'purchase_receipt',
      document_date: '2026-10-12',
    }),
    ...receiptFields,
    order_id: ORDER_1,
    status: 'draft' as const,
    lines: [
      receiptLine({
        id: 'rd-bolt',
        line_no: 1,
        item_id: ITEM_BOLT,
        quantity: '6.000000',
        order_line_id: 'ol-bolt',
      }),
      receiptLine({
        id: 'rd-phone',
        line_no: 2,
        item_id: ITEM_PHONE,
        quantity: '2.000000',
        unit_price: '1000.000000',
        order_line_id: 'ol-phone',
      }),
    ],
  })
  const receiptPosted = withTotals({
    ...header({
      id: RECEIPT_POSTED,
      document_type: 'purchase_receipt',
      number: 'GRN2026000000001',
      document_date: '2026-10-06',
      version: 3,
    }),
    ...receiptFields,
    status: 'posted' as const,
    order_id: ORDER_1,
    supplier_reference: 'IRS-77',
    stock_document_id: 'sd-1',
    journal_entry_id: 'je-grn-1',
    cost_total: '200.0000',
    posted_at: '2026-10-06T09:00:00Z',
    lines: [
      receiptLine({
        id: 'rp-bolt',
        line_no: 1,
        item_id: ITEM_BOLT,
        quantity: '4.000000',
        order_line_id: 'ol-bolt',
        lot_no: 'L-1',
        expiry_date: '2027-06-30',
        unit_cost: '50.000000',
        cost_total: '200.0000',
      }),
    ],
  })
  const invDraftLines = [
    invoiceLine({
      id: 'id-bolt',
      line_no: 1,
      item_id: ITEM_BOLT,
      quantity: '4.000000',
      unit_price: '55.000000',
      price_source: 'manual',
      receipt_line_id: 'rp-bolt',
      order_line_id: 'ol-bolt',
    }),
  ]
  const invoiceDraft = withTotals({
    ...header({
      id: INVOICE_DRAFT,
      document_type: 'purchase_invoice',
      document_date: '2026-10-14',
      version: 2,
    }),
    ...invoiceFields,
    status: 'draft' as const,
    supplier_invoice_no: 'TDR-2026-118',
    lines: invDraftLines,
  })
  const bookedLines = [
    invoiceLine({
      id: 'ib-bolt',
      line_no: 1,
      item_id: ITEM_BOLT,
      quantity: '4.000000',
      unit_price: '50.000000',
      price_source: 'source',
      receipt_line_id: 'rp-bolt',
      order_line_id: 'ol-bolt',
      match_status: 'matched',
      withholding_code_id: WHT_510,
      withholding_rate: '50.0000',
    }),
  ]
  const booked = withTotals({
    ...header({
      id: INVOICE_BOOKED,
      document_type: 'purchase_invoice',
      number: 'PIN2026000000007',
      document_date: '2026-09-01',
      due_date: '2026-10-01',
      version: 4,
    }),
    ...invoiceFields,
    status: 'booked' as const,
    supplier_invoice_no: 'TDR-2026-090',
    journal_entry_id: 'je-pin-7',
    match_status: 'matched' as const,
    booked_at: '2026-09-01T10:00:00Z',
    lines: bookedLines,
  })
  // 4 × 50 = 200 net, 40 VAT, 20 withheld (5/10): payable 220.
  booked.payable_total = D(booked.total).minus(D(booked.withholding_total)).toFixed(4)
  booked.balance_due = booked.payable_total
  const ret = withTotals({
    ...header({ id: RETURN_DRAFT, document_type: 'purchase_return', document_date: '2026-10-15' }),
    status: 'draft' as const,
    invoice_id: INVOICE_BOOKED,
    receipt_id: null,
    reason: 'Hasarlı',
    stock_document_id: null,
    journal_entry_id: null,
    debit_invoice_id: null,
    approved_at: null,
    shipped_at: null,
    debited_at: null,
    cancelled_at: null,
    lines: [
      {
        ...line({
          id: 'rt-bolt',
          line_no: 1,
          item_id: ITEM_BOLT,
          quantity: '1.000000',
          unit_price: '50.000000',
        }),
        invoice_line_id: 'ib-bolt',
        receipt_line_id: 'rp-bolt',
        lot_no: 'L-1',
        serial_numbers: [],
        unit_cost: null,
        cost_total: null,
        receipt_cost: null,
      },
    ],
  })
  const db: PurchDocsDb = {
    orders: [order],
    receipts: [receiptDraft, receiptPosted],
    invoices: [invoiceDraft, booked],
    returns: [ret],
    match: {},
    matchMode: 'warn',
    allowDirectReceipt: false,
    permissions: [],
    summary: {
      [SUPPLIER]: {
        party_id: SUPPLIER,
        currency: 'TRY',
        exposure: {
          party_id: SUPPLIER,
          currency: 'TRY',
          open_payables: '220.00',
          open_orders: '600.00',
          total: '820.00',
          overdue_payables: '220.00',
        },
        orders: { open_count: 1, open_value: '600.00' },
        invoices: {
          count: 1,
          invoiced_total: '240.00',
          debited_total: '0.00',
          balance_due: '220.00',
          last_invoice_date: '2026-09-01',
        },
        recent_orders: [],
        recent_invoices: [],
      },
    },
    performance: {
      [SUPPLIER]: {
        party_id: SUPPLIER,
        from: '2025-10-22',
        to: '2026-10-22',
        orders: 3,
        on_time_rate: '0.7500',
        fill_rate: '0.9000',
        avg_lead_days: '4.5',
        price_variance_total: '20.00',
        return_rate: '0.0200',
        overdue_payable: '220.00',
      },
    },
    exposure: {},
    reports: {},
    failNext: {},
    failAfterCommit: {},
    calls: [],
    idempotency: new Map(),
    seq: 0,
    numberSeq: {},
    ...overrides,
  }
  db.summary[SUPPLIER]?.recent_invoices.push({ ...linkOf(booked), balance_due: booked.balance_due })
  db.summary[SUPPLIER]?.recent_orders.push(
    linkOf({ ...order, document_type: 'purchase_order', total: '1800.0000' }),
  )
  return db
}

function linkOf(d: {
  id: string
  document_type: string
  number: string | null
  status: string
  document_date: string
  total?: string
  currency_code: string
  invoice_type?: string
}): ApiLink {
  return {
    id: d.id,
    document_type: (d.invoice_type === 'return'
      ? 'purchase_debit_note'
      : d.document_type) as ApiLink['document_type'],
    number: d.number,
    status: d.status,
    document_date: d.document_date,
    total: d.total ?? null,
    currency_code: d.currency_code,
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
const notFound = () => error(404, 'NOT_FOUND', 'Kayıt bulunamadı.')
const conflict = () =>
  error(409, 'VERSION_CONFLICT', 'Kayıt siz düzenlerken başka biri tarafından değiştirildi.')
const transition = () => error(422, 'INVALID_STATE_TRANSITION', 'Bu durumda işlem yapılamaz.')
/** DocumentService::assertDraft: edit or delete past draft, answered before the version check. */
const locked = () => error(409, 'DOCUMENT_LOCKED', 'Yalnızca taslak belgeler düzenlenebilir.')

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

const row = <T extends { lines: unknown[] }>(d: T) => {
  const out: Partial<T> & { line_count: number } = { ...d, line_count: d.lines.length }
  delete out.lines
  return out
}

const filtered = <T extends { status: string; party_id: string }>(rows: T[], url: URL) =>
  rows.filter((r) => {
    const status = url.searchParams.get('filter[status]')
    const party = url.searchParams.get('filter[party_id]')
    return (!status || status.split(',').includes(r.status)) && (!party || r.party_id === party)
  })

/** Reports and their group_by values as PurchaseReportRequest declares them. */
const REPORT_SPECS: Record<string, { groups: string[] }> = {
  'purchases-by-period': { groups: [] },
  'by-supplier': { groups: [] },
  'by-item': { groups: [] },
  'top-suppliers': { groups: [] },
  'open-orders': { groups: ['line', 'order', 'supplier', 'item'] },
  'receipt-vs-invoice': { groups: ['line', 'receipt', 'supplier', 'item'] },
  'supplier-ageing': { groups: ['supplier', 'supplier_currency', 'invoice'] },
  'price-variance': { groups: ['line', 'supplier', 'item'] },
  'supplier-performance': { groups: [] },
  'return-rate': { groups: ['supplier', 'item', 'category'] },
  'rfq-savings': { groups: ['rfq', 'line', 'supplier'] },
}
const REPORT_PARAMS = [
  'date_from',
  'date_to',
  'as_of',
  'party_id',
  'item_id',
  'category_id',
  'warehouse_id',
  'currency_code',
  'group_by',
  'period',
  'limit',
  'page',
  'per_page',
  'format',
]

export function purchDocsHandlers(db: PurchDocsDb) {
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
    const path = (payload as { path?: string } | null)?.path ?? ''
    const lost = db.failAfterCommit[path] ?? 0
    if (lost > 0) {
      db.failAfterCommit[path] = lost - 1
      return HttpResponse.error()
    }
    return HttpResponse.json(out.body as Record<string, unknown>, { status: out.status })
  }

  const nextNumber = (prefix: string) => {
    db.numberSeq[prefix] = (db.numberSeq[prefix] ?? 0) + 10
    return `${prefix}2026${String(db.numberSeq[prefix]).padStart(9, '0')}`
  }
  const newId = (p: string) => `${p}-${++db.seq}`
  const order = (id: string | null) => db.orders.find((o) => o.id === id)
  const receiptLineById = (id: string) =>
    db.receipts.flatMap((r) => r.lines).find((l) => l.id === id)
  const invoiceLineById = (id: string) =>
    db.invoices.flatMap((i) => i.lines).find((l) => l.id === id)

  const invoiceLinks = (inv: RawInvoice) => {
    const receiptIds = new Set(
      inv.lines.flatMap((l) =>
        db.receipts.filter((r) => r.lines.some((x) => x.id === l.receipt_line_id)).map((r) => r.id),
      ),
    )
    const orderIds = new Set(
      inv.lines.flatMap((l) =>
        db.orders.filter((o) => o.lines.some((x) => x.id === l.order_line_id)).map((o) => o.id),
      ),
    )
    const o = order([...orderIds][0] ?? null)
    return {
      order: o ? linkOf({ ...o, document_type: 'purchase_order' }) : null,
      receipts: db.receipts.filter((r) => receiptIds.has(r.id)).map(linkOf),
      returns: db.returns.filter((r) => r.invoice_id === inv.id).map(linkOf),
      debit_notes: db.invoices.filter((i) => i.original_invoice_id === inv.id).map(linkOf),
      original_invoice: (() => {
        const orig = db.invoices.find((i) => i.id === inv.original_invoice_id)
        return orig ? linkOf(orig) : null
      })(),
      return: null,
    }
  }
  const receiptLinks = (r: RawReceipt) => {
    const o = order(r.order_id)
    return {
      order: o ? linkOf({ ...o, document_type: 'purchase_order' }) : null,
      invoices: db.invoices
        .filter((i) => i.lines.some((l) => r.lines.some((x) => x.id === l.receipt_line_id)))
        .map(linkOf),
      invoice: null,
      returns: db.returns.filter((x) => x.receipt_id === r.id).map(linkOf),
    }
  }
  const returnLinks = (r: RawReturn) => {
    const inv = db.invoices.find((i) => i.id === r.invoice_id)
    const rec = db.receipts.find((i) => i.id === r.receipt_id)
    const debit = db.invoices.find((i) => i.id === r.debit_invoice_id)
    return {
      invoice: inv ? linkOf(inv) : null,
      receipt: rec ? linkOf(rec) : null,
      debit_invoice: debit ? linkOf(debit) : null,
    }
  }
  const matchOf = (inv: RawInvoice): Record<string, unknown> & { status?: string } => ({
    mode: db.matchMode,
    ...(db.match[inv.id] ?? matchFor(inv, db.orders)),
    override_reason: inv.match_override_reason,
    override_by: inv.match_override_by,
  })

  const printModel = (doc: RawReceipt | RawInvoice | RawReturn): PrintModel => {
    const head: Record<string, unknown> = { ...doc }
    delete head.lines
    const taxes = new Map<string, { base: Decimal; tax: Decimal; w: Decimal }>()
    for (const l of doc.lines) {
      const t = taxes.get(l.tax_rate) ?? { base: D(0), tax: D(0), w: D(0) }
      taxes.set(l.tax_rate, {
        base: t.base.plus(l.net_amount),
        tax: t.tax.plus(l.tax_amount),
        w: t.w.plus(l.withholding_amount),
      })
    }
    return {
      document_type:
        'invoice_type' in doc && doc.invoice_type === 'return'
          ? 'purchase_debit_note'
          : doc.document_type,
      company: {
        id: 'company-a',
        name: 'Anadolu Makina A.Ş.',
        tax_office: 'Kadıköy',
        tax_number: '1112223334',
      },
      document: head as PrintModel['document'],
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
          withholding_rate: l.withholding_rate,
          withholding_amount: l.withholding_amount,
          line_total: l.line_total,
          lot_no: 'lot_no' in l ? l.lot_no : null,
          serial_numbers: 'serial_numbers' in l ? (l.serial_numbers ?? []) : [],
        }
      }),
      taxes: [...taxes].map(([rate, t]) => ({
        rate,
        base: t.base.toFixed(2),
        tax: t.tax.toFixed(2),
        withholding: t.w.toFixed(2),
      })),
      totals: {
        subtotal: doc.subtotal,
        discount_total: doc.discount_total,
        tax_total: doc.tax_total,
        total: doc.total,
        withholding_total: doc.withholding_total,
      },
    }
  }

  const lookup = <T>(path: string, rows: () => T[]) =>
    http.get(`${base}${path}`, async ({ request }) => {
      const { url } = await record(request)
      return HttpResponse.json(paginate(rows(), url, 100))
    })

  /** Invoice lines from a PATCH/POST body (sources copied from receipt/order lines). */
  const invoiceLinesFrom = (id: string, lines: Record<string, unknown>[]): ApiInvoiceLine[] =>
    lines.map((b, i) => {
      const str = (k: string) => (typeof b[k] === 'string' ? b[k] : null)
      const rl = str('receipt_line_id') ? receiptLineById(str('receipt_line_id') ?? '') : undefined
      const olId = rl?.order_line_id ?? str('order_line_id')
      const ol = db.orders.flatMap((o) => o.lines).find((x) => x.id === olId)
      const src = rl ?? ol
      const price = str('unit_price') ?? src?.unit_price ?? '0'
      return invoiceLine({
        id: `${id}-l${i + 1}`,
        line_no: i + 1,
        item_id: str('item_id') ?? src?.item_id ?? ITEM_BOLT,
        item_type: itemType(str('item_id') ?? src?.item_id ?? ITEM_BOLT),
        quantity: D(str('quantity') ?? '1').toFixed(6),
        unit_price: D(price).toFixed(6),
        price_source: src && D(price).equals(D(src.unit_price)) ? 'source' : 'manual',
        receipt_line_id: rl?.id ?? null,
        order_line_id: olId ?? null,
        tax_code_id: src ? src.tax_code_id : str('tax_code_id'),
        withholding_code_id: src ? src.withholding_code_id : str('withholding_code_id'),
        withholding_rate:
          (src ? src.withholding_code_id : str('withholding_code_id')) === WHT_510
            ? '50.0000'
            : '0.0000',
      })
    })

  const respond = <T>(data: T, meta?: Record<string, unknown>) => ({
    status: 200,
    body: { data, ...(meta ? { meta } : {}) },
  })

  return [
    // ---- Exports (before the :id routes they would otherwise match) ----
    http.get(`${base}/purchase-reports/:name/export`, async ({ request }) => {
      const { url } = await record(request)
      const format = url.searchParams.get('format') ?? 'csv'
      return new HttpResponse('a;b\n1;2\n', {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="report.${format}"`,
        },
      })
    }),
    http.get(`${base}/:resource/export`, async ({ request }) => {
      const { url } = await record(request)
      const format = url.searchParams.get('format') ?? 'csv'
      return new HttpResponse('a;b\n1;2\n', {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="export.${format}"`,
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
      {
        id: WHT_510,
        company_id: null,
        type: 'withholding',
        code: 'TEV510',
        name: 'Tevkifat 5/10',
        rate: null,
        numerator: 5,
        denominator: 10,
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
        id: SUPPLIER,
        code: 'S001',
        name: 'Tedarik Ltd.',
        roles: ['supplier'],
        tax_number: '9876543210',
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

    // ---- Orders (read by the receipt editor) ----
    http.get(`${base}/purchase-orders/:id`, async ({ request, params }) => {
      await record(request)
      const o = order(String(params.id))
      return o ? HttpResponse.json({ data: { ...o, links: {}, audit: [] } }) : notFound()
    }),
    http.post(`${base}/purchase-orders/:id/receipts`, async ({ request, params }) => {
      const { body, path, failed } = await record(request)
      if (failed) return HttpResponse.error()
      const o = order(String(params.id))
      if (!o) return notFound()
      const b = body as {
        document_date: string
        warehouse_id: string
        supplier_reference: string | null
        lines: {
          order_line_id: string
          quantity: string
          lot_no: string | null
          expiry_date: string | null
          serial_numbers: string[]
        }[]
      }
      return idempotent(request, { path, ...b }, () => {
        const over = b.lines.findIndex((l) => {
          const ol = o.lines.find((x) => x.id === l.order_line_id)
          return !ol || D(l.quantity).greaterThan(D(ol.quantity).minus(D(ol.received_quantity)))
        })
        if (over >= 0)
          return error(422, 'VALIDATION_ERROR', 'Kalan miktar aşıldı.', {
            [`lines.${over}.quantity`]: ['Kalan miktar aşıldı.'],
          })
        const id = newId('receipt')
        const r = withTotals({
          ...header({
            id,
            document_type: 'purchase_receipt',
            document_date: b.document_date,
            warehouse_id: b.warehouse_id,
          }),
          ...receiptFields,
          status: 'draft' as const,
          order_id: o.id,
          supplier_reference: b.supplier_reference,
          lines: b.lines.map((l, i) => {
            const ol = o.lines.find((x) => x.id === l.order_line_id)
            return receiptLine({
              id: `${id}-l${i + 1}`,
              line_no: i + 1,
              item_id: ol?.item_id ?? ITEM_BOLT,
              quantity: D(l.quantity).toFixed(6),
              unit_price: ol?.unit_price ?? '0',
              order_line_id: l.order_line_id,
              lot_no: l.lot_no,
              expiry_date: l.expiry_date,
              serial_numbers: l.serial_numbers,
            })
          }),
        })
        db.receipts.push(r)
        return { status: 201, body: { data: r } }
      })
    }),

    // ---- Receipts ----
    http.get(`${base}/purchase-receipts`, async ({ request }) => {
      const { url } = await record(request)
      return HttpResponse.json(paginate(filtered(db.receipts, url).map(row), url))
    }),
    http.get(`${base}/purchase-receipts/:id/print-model`, async ({ request, params }) => {
      await record(request)
      const r = db.receipts.find((x) => x.id === params.id)
      return r ? HttpResponse.json({ data: printModel(r) }) : notFound()
    }),
    http.get(`${base}/purchase-receipts/:id`, async ({ request, params }) => {
      await record(request)
      const r = db.receipts.find((x) => x.id === params.id)
      return r ? HttpResponse.json({ data: { ...r, links: receiptLinks(r), audit } }) : notFound()
    }),
    http.post(`${base}/purchase-receipts`, async ({ request }) => {
      const { body, path } = await record(request)
      return idempotent(request, { path, body }, () => {
        if (!db.allowDirectReceipt)
          return error(422, 'VALIDATION_ERROR', 'Siparişsiz mal kabul kapalı.', {
            order_id: ['Siparişsiz mal kabul kapalı.'],
          })
        const b = body as {
          party_id: string
          document_date: string
          warehouse_id: string
          lines: {
            item_id: string
            quantity: string
            unit_price: string
            lot_no: string | null
            expiry_date: string | null
            serial_numbers: string[]
          }[]
        }
        const id = newId('receipt')
        const r = withTotals({
          ...header({
            id,
            document_type: 'purchase_receipt',
            document_date: b.document_date,
            warehouse_id: b.warehouse_id,
            party_id: b.party_id,
          }),
          ...receiptFields,
          status: 'draft' as const,
          lines: b.lines.map((l, i) =>
            receiptLine({
              id: `${id}-l${i + 1}`,
              line_no: i + 1,
              item_id: l.item_id,
              quantity: D(l.quantity).toFixed(6),
              unit_price: D(l.unit_price).toFixed(6),
              lot_no: l.lot_no,
              expiry_date: l.expiry_date,
              serial_numbers: l.serial_numbers,
            }),
          ),
        })
        db.receipts.push(r)
        return { status: 201, body: { data: r } }
      })
    }),
    http.patch(`${base}/purchase-receipts/:id`, async ({ request, params }) => {
      const { body } = await record(request)
      const r = db.receipts.find((x) => x.id === params.id)
      if (!r) return notFound()
      const b = body as {
        version: number
        document_date: string
        warehouse_id: string
        supplier_reference: string | null
        notes: string | null
        lines: {
          order_line_id?: string
          item_id?: string
          quantity: string
          unit_price?: string
          lot_no: string | null
          expiry_date: string | null
          serial_numbers: string[]
        }[]
      }
      if (r.status !== 'draft') return locked()
      if (b.version !== r.version) return conflict()
      const o = order(r.order_id)
      r.document_date = b.document_date
      r.warehouse_id = b.warehouse_id
      r.supplier_reference = b.supplier_reference
      r.notes = b.notes
      r.lines = b.lines.map((l, i) => {
        const ol = o?.lines.find((x) => x.id === l.order_line_id)
        return receiptLine({
          id: `${r.id}-v${r.version}-l${i + 1}`,
          line_no: i + 1,
          item_id: ol?.item_id ?? l.item_id ?? ITEM_BOLT,
          quantity: D(l.quantity).toFixed(6),
          unit_price: ol?.unit_price ?? l.unit_price ?? '0',
          order_line_id: l.order_line_id ?? null,
          lot_no: l.lot_no,
          expiry_date: l.expiry_date,
          serial_numbers: l.serial_numbers,
        })
      })
      Object.assign(r, totals(r.lines))
      r.version++
      return HttpResponse.json({ data: r })
    }),
    http.delete(`${base}/purchase-receipts/:id`, async ({ request, params }) => {
      await record(request)
      const r = db.receipts.find((x) => x.id === params.id)
      if (r && r.status !== 'draft') return locked()
      db.receipts = db.receipts.filter((x) => x.id !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${base}/purchase-receipts/:id/post`, async ({ request, params }) => {
      const { body, path, failed } = await record(request)
      if (failed) return HttpResponse.error()
      const r = db.receipts.find((x) => x.id === params.id)
      if (!r) return notFound()
      const b = (body ?? {}) as { version?: number }
      return idempotent(request, { path, ...b }, () => {
        if (r.status === 'posted') return respond(r, { replayed: true })
        if (b.version !== undefined && b.version !== r.version) return conflict()
        if (r.status !== 'draft') return transition()
        r.status = 'posted'
        r.number = nextNumber('GRN')
        r.stock_document_id = 'sd-new'
        r.journal_entry_id = 'je-grn-new'
        r.posted_at = '2026-10-22T10:00:00Z'
        r.cost_total = r.lines.reduce((a, l) => a.plus(D(l.net_amount)), D(0)).toFixed(4)
        r.version++
        return respond(r)
      })
    }),
    http.post(`${base}/purchase-receipts/:id/cancel`, async ({ request, params }) => {
      const { body, path } = await record(request)
      const r = db.receipts.find((x) => x.id === params.id)
      if (!r) return notFound()
      const b = (body ?? {}) as { version?: number; reason?: string; date?: string }
      return idempotent(request, { path, ...b }, () => {
        if (b.version !== undefined && b.version !== r.version) return conflict()
        if (r.status === 'posted') {
          if (!b.reason)
            return error(422, 'VALIDATION_ERROR', 'Neden gerekli.', { reason: ['Neden gerekli.'] })
          r.reversal_date = b.date ?? '2026-10-22'
          r.reversal_stock_document_id = 'sd-rev'
        } else if (r.status !== 'draft') return transition()
        r.status = 'cancelled'
        r.cancel_reason = b.reason ?? null
        r.cancelled_at = '2026-10-22T10:00:00Z'
        r.version++
        return respond(r)
      })
    }),
    http.post(`${base}/purchase-receipts/:id/invoice`, async ({ request, params }) => {
      const { body, path } = await record(request)
      const r = db.receipts.find((x) => x.id === params.id)
      if (!r) return notFound()
      const b = body as {
        document_date: string
        due_date: string | null
        supplier_invoice_no: string | null
      }
      return idempotent(request, { path, ...b }, () => {
        const id = newId('invoice')
        const inv = withTotals({
          ...header({
            id,
            document_type: 'purchase_invoice',
            document_date: b.document_date,
            due_date: b.due_date,
          }),
          ...invoiceFields,
          status: 'draft' as const,
          supplier_invoice_no: b.supplier_invoice_no,
          lines: invoiceLinesFrom(
            id,
            r.lines.map((l) => ({ receipt_line_id: l.id, quantity: l.quantity })),
          ),
        })
        db.invoices.push(inv)
        return { status: 201, body: { data: inv } }
      })
    }),
    http.post(`${base}/purchase-receipts/:id/returns`, async ({ request, params }) => {
      const { body, path } = await record(request)
      const r = db.receipts.find((x) => x.id === params.id)
      if (!r) return notFound()
      const b = body as {
        document_date: string
        warehouse_id: string | null
        reason: string | null
        lines: {
          receipt_line_id: string
          quantity: string
          lot_no: string | null
          serial_numbers: string[]
        }[]
      }
      return idempotent(request, { path, ...b }, () => {
        const id = newId('return')
        const ret = withTotals({
          ...header({ id, document_type: 'purchase_return', document_date: b.document_date }),
          status: 'draft' as const,
          invoice_id: null,
          receipt_id: r.id,
          reason: b.reason,
          stock_document_id: null,
          journal_entry_id: null,
          debit_invoice_id: null,
          approved_at: null,
          shipped_at: null,
          debited_at: null,
          cancelled_at: null,
          lines: b.lines.map((l, i) => {
            const src = receiptLineById(l.receipt_line_id)
            return {
              ...line({
                id: `${id}-l${i + 1}`,
                line_no: i + 1,
                item_id: src?.item_id ?? ITEM_BOLT,
                quantity: D(l.quantity).toFixed(6),
                unit_price: src?.unit_price ?? '0',
              }),
              invoice_line_id: null,
              receipt_line_id: l.receipt_line_id,
              lot_no: l.lot_no,
              serial_numbers: l.serial_numbers,
              unit_cost: null,
              cost_total: null,
              receipt_cost: null,
            }
          }),
        })
        db.returns.push(ret)
        return { status: 201, body: { data: ret } }
      })
    }),

    // ---- Invoices ----
    http.get(`${base}/purchase-invoices`, async ({ request }) => {
      const { url } = await record(request)
      let rows = filtered(db.invoices, url)
      if (url.searchParams.get('filter[open]') === '1')
        rows = rows.filter(
          (i) => ['booked', 'partially_paid'].includes(i.status) && D(i.balance_due).greaterThan(0),
        )
      const mt = url.searchParams.get('filter[match_status]')
      if (mt) rows = rows.filter((i) => i.match_status === mt)
      return HttpResponse.json(paginate(rows.map(row), url))
    }),
    http.get(`${base}/purchase-invoices/:id/print-model`, async ({ request, params }) => {
      await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      return inv ? HttpResponse.json({ data: printModel(inv) }) : notFound()
    }),
    http.get(`${base}/purchase-invoices/:id/match`, async ({ request, params }) => {
      await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      return inv ? HttpResponse.json({ data: matchOf(inv) }) : notFound()
    }),
    http.get(`${base}/purchase-invoices/:id`, async ({ request, params }) => {
      await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      return inv
        ? HttpResponse.json({
            data: { ...inv, links: invoiceLinks(inv), match: matchOf(inv), audit },
          })
        : notFound()
    }),
    http.post(`${base}/purchase-invoices`, async ({ request }) => {
      const { body, path } = await record(request)
      const b = body as {
        party_id: string
        supplier_invoice_no: string | null
        document_date: string
        lines: Record<string, unknown>[]
      }
      return idempotent(request, { path, ...b }, () => {
        const id = newId('invoice')
        const inv = withTotals({
          ...header({
            id,
            document_type: 'purchase_invoice',
            document_date: b.document_date,
            party_id: b.party_id,
          }),
          ...invoiceFields,
          status: 'draft' as const,
          supplier_invoice_no: b.supplier_invoice_no,
          lines: invoiceLinesFrom(id, b.lines),
        })
        db.invoices.push(inv)
        return { status: 201, body: { data: inv } }
      })
    }),
    http.patch(`${base}/purchase-invoices/:id`, async ({ request, params }) => {
      const { body } = await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      if (!inv) return notFound()
      const b = body as {
        version: number
        supplier_invoice_no: string | null
        document_date: string
        due_date: string | null
        receive_on_invoice: boolean
        lines: Record<string, unknown>[]
      }
      if (inv.status !== 'draft') return locked()
      if (b.version !== inv.version) return conflict()
      if (
        b.supplier_invoice_no &&
        db.invoices.some(
          (i) =>
            i.id !== inv.id &&
            i.supplier_invoice_no === b.supplier_invoice_no &&
            !['cancelled', 'reversed'].includes(i.status),
        )
      )
        return error(422, 'VALIDATION_ERROR', 'Bu tedarikçi fatura numarası zaten kayıtlı.', {
          supplier_invoice_no: ['Bu tedarikçi fatura numarası zaten kayıtlı.'],
        })
      inv.supplier_invoice_no = b.supplier_invoice_no
      inv.document_date = b.document_date
      inv.due_date = b.due_date
      inv.receive_on_invoice = b.receive_on_invoice
      inv.lines = invoiceLinesFrom(`${inv.id}-v${inv.version}`, b.lines)
      Object.assign(inv, totals(inv.lines))
      inv.version++
      return HttpResponse.json({ data: inv })
    }),
    http.delete(`${base}/purchase-invoices/:id`, async ({ request, params }) => {
      await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      if (inv && inv.status !== 'draft') return locked()
      db.invoices = db.invoices.filter((x) => x.id !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${base}/purchase-invoices/:id/book`, async ({ request, params }) => {
      const { body, path, failed } = await record(request)
      if (failed) return HttpResponse.error()
      const inv = db.invoices.find((x) => x.id === params.id)
      if (!inv) return notFound()
      const b = (body ?? {}) as { version?: number; match_override_reason?: string }
      return idempotent(request, { path, ...b }, () => {
        if (['booked', 'partially_paid', 'paid'].includes(inv.status))
          return respond(inv, { replayed: true })
        if (b.version !== undefined && b.version !== inv.version) return conflict()
        if (inv.status !== 'draft') return transition()
        if (!inv.supplier_invoice_no)
          return error(422, 'VALIDATION_ERROR', 'Tedarikçi fatura no gerekli.', {
            supplier_invoice_no: ['Tedarikçi fatura no gerekli.'],
          })
        const m = matchOf(inv)
        const variance = m.status === 'qty_variance' || m.status === 'price_variance'
        const warnings: { code: string; message: string }[] = []
        if (variance && db.matchMode === 'block') {
          const allowed =
            !!b.match_override_reason?.trim() &&
            db.permissions.includes('purchasing.match_override')
          if (!allowed)
            return error(
              422,
              'purchasing.match_failed',
              'Üç yönlü eşleştirme başarısız.',
              { lines: ['Üç yönlü eşleştirme başarısız.'] },
              m,
            )
          inv.match_override_reason = b.match_override_reason ?? null
          inv.match_override_by = 'u1'
        }
        if (variance && db.matchMode === 'warn')
          warnings.push({
            code: 'purchasing.match_variance',
            message: 'Eşleştirmede fark var (uyarı).',
          })
        inv.status = 'booked'
        inv.number = nextNumber('PIN')
        inv.match_status = (m.status as RawInvoice['match_status']) ?? 'matched'
        inv.journal_entry_id = 'je-pin-new'
        inv.booked_at = '2026-10-22T10:00:00Z'
        inv.payable_total = D(inv.total).minus(D(inv.withholding_total)).toFixed(4)
        inv.balance_due = inv.payable_total
        inv.version++
        return respond(inv, warnings.length > 0 ? { warnings } : undefined)
      })
    }),
    http.post(`${base}/purchase-invoices/:id/reverse`, async ({ request, params }) => {
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
        if (b.version !== undefined && b.version !== inv.version) return conflict()
        if (inv.status !== 'booked') return transition()
        inv.status = 'reversed'
        inv.reversal_journal_entry_id = 'je-rev'
        inv.reversal_reason = b.reason ?? null
        inv.reversal_date = b.date ?? null
        inv.version++
        return respond(inv)
      })
    }),
    http.post(`${base}/purchase-invoices/:id/cancel`, async ({ request, params }) => {
      const { body, path } = await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      if (!inv) return notFound()
      const b = (body ?? {}) as { version?: number }
      return idempotent(request, { path, ...b }, () => {
        if (b.version !== undefined && b.version !== inv.version) return conflict()
        inv.status = 'cancelled'
        inv.version++
        return respond(inv)
      })
    }),
    http.post(`${base}/purchase-invoices/:id/returns`, async ({ request, params }) => {
      const { body, path } = await record(request)
      const inv = db.invoices.find((x) => x.id === params.id)
      if (!inv) return notFound()
      const b = body as {
        document_date: string
        warehouse_id: string | null
        reason: string | null
        lines: {
          invoice_line_id: string
          quantity: string
          lot_no: string | null
          serial_numbers: string[]
        }[]
      }
      return idempotent(request, { path, ...b }, () => {
        const id = newId('return')
        const ret = withTotals({
          ...header({ id, document_type: 'purchase_return', document_date: b.document_date }),
          status: 'draft' as const,
          invoice_id: inv.id,
          receipt_id: null,
          reason: b.reason,
          stock_document_id: null,
          journal_entry_id: null,
          debit_invoice_id: null,
          approved_at: null,
          shipped_at: null,
          debited_at: null,
          cancelled_at: null,
          lines: b.lines.map((l, i) => {
            const src = invoiceLineById(l.invoice_line_id)
            return {
              ...line({
                id: `${id}-l${i + 1}`,
                line_no: i + 1,
                item_id: src?.item_id ?? ITEM_BOLT,
                quantity: D(l.quantity).toFixed(6),
                unit_price: src?.unit_price ?? '0',
              }),
              invoice_line_id: l.invoice_line_id,
              receipt_line_id: src?.receipt_line_id ?? null,
              lot_no: l.lot_no,
              serial_numbers: l.serial_numbers,
              unit_cost: null,
              cost_total: null,
              receipt_cost: null,
            }
          }),
        })
        db.returns.push(ret)
        return { status: 201, body: { data: ret } }
      })
    }),
    http.post(`${base}/purchase-documents/preview-totals`, async ({ request }) => {
      const { body } = await record(request)
      const b = body as {
        lines: {
          item_id: string
          quantity: string
          unit_price: string | null
          tax_code_id: string | null
          withholding_code_id: string | null
        }[]
      }
      const lines = b.lines.map((l, i) =>
        line({
          id: `p${i}`,
          item_id: l.item_id,
          quantity: D(l.quantity).toFixed(6),
          unit_price: D(l.unit_price ?? '0').toFixed(6),
          tax_code_id: l.tax_code_id,
          withholding_code_id: l.withholding_code_id,
          withholding_rate: l.withholding_code_id === WHT_510 ? '50.0000' : '0.0000',
        }),
      )
      return HttpResponse.json({ data: { header: {}, lines, taxes: [], totals: totals(lines) } })
    }),

    // ---- Returns ----
    http.get(`${base}/purchase-returns`, async ({ request }) => {
      const { url } = await record(request)
      return HttpResponse.json(paginate(filtered(db.returns, url).map(row), url))
    }),
    http.get(`${base}/purchase-returns/:id/print-model`, async ({ request, params }) => {
      await record(request)
      const r = db.returns.find((x) => x.id === params.id)
      return r ? HttpResponse.json({ data: printModel(r) }) : notFound()
    }),
    http.get(`${base}/purchase-returns/:id`, async ({ request, params }) => {
      await record(request)
      const r = db.returns.find((x) => x.id === params.id)
      return r ? HttpResponse.json({ data: { ...r, links: returnLinks(r), audit } }) : notFound()
    }),
    http.delete(`${base}/purchase-returns/:id`, async ({ request, params }) => {
      await record(request)
      const r = db.returns.find((x) => x.id === params.id)
      if (r && r.status !== 'draft') return locked()
      db.returns = db.returns.filter((x) => x.id !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${base}/purchase-returns/:id/:action`, async ({ request, params }) => {
      const { body, path, failed } = await record(request)
      if (failed) return HttpResponse.error()
      const r = db.returns.find((x) => x.id === params.id)
      if (!r) return notFound()
      const action = String(params.action)
      const b = (body ?? {}) as { version?: number }
      const next: Record<string, [string[], RawReturn['status']]> = {
        approve: [['draft'], 'approved'],
        ship: [['approved'], 'shipped'],
        debit: [['shipped'], 'debited'],
        cancel: [['draft', 'approved'], 'cancelled'],
      }
      const step = next[action]
      if (!step) return notFound()
      return idempotent(request, { path, ...b }, () => {
        if (r.status === step[1]) return respond(r, { replayed: true })
        if (b.version !== undefined && b.version !== r.version) return conflict()
        if (!step[0].includes(r.status)) return transition()
        if (action === 'debit' && !r.invoice_id) return transition()
        r.status = step[1]
        if (action === 'approve') r.number = nextNumber('PRT')
        if (action === 'ship') {
          r.stock_document_id = 'sd-ret'
          r.journal_entry_id = 'je-ret'
          r.shipped_at = '2026-10-22T10:00:00Z'
        }
        if (action === 'debit') {
          const id = newId('debit')
          const orig = db.invoices.find((i) => i.id === r.invoice_id)
          const note = withTotals({
            ...header({
              id,
              document_type: 'purchase_debit_note',
              number: nextNumber('PDN'),
              document_date: '2026-10-22',
            }),
            ...invoiceFields,
            invoice_type: 'return' as const,
            status: 'booked' as const,
            original_invoice_id: orig?.id ?? null,
            return_id: r.id,
            lines: r.lines.map((l, i) =>
              invoiceLine({
                id: `${id}-l${i + 1}`,
                line_no: i + 1,
                item_id: l.item_id,
                quantity: l.quantity,
                unit_price: l.unit_price,
              }),
            ),
          }) as RawInvoice
          db.invoices.push(note)
          r.debit_invoice_id = id
        }
        r.version++
        return respond(r)
      })
    }),

    // ---- Suppliers ----
    http.get(`${base}/suppliers/:id/exposure`, async ({ request, params }) => {
      await record(request)
      const e = db.exposure[String(params.id)] ?? db.summary[String(params.id)]?.exposure
      return e ? HttpResponse.json({ data: e }) : notFound()
    }),
    http.get(`${base}/suppliers/:id/purchase-summary`, async ({ request, params }) => {
      await record(request)
      const s = db.summary[String(params.id)]
      return s ? HttpResponse.json({ data: s }) : notFound()
    }),
    http.get(`${base}/suppliers/:id/performance`, async ({ request, params }) => {
      const { url } = await record(request)
      const p = db.performance[String(params.id)]
      return p
        ? HttpResponse.json({
            data: {
              ...p,
              from: url.searchParams.get('from') ?? p.from,
              to: url.searchParams.get('to') ?? p.to,
            },
          })
        : notFound()
    }),

    // ---- Reports ----
    http.get(`${base}/purchase-reports/:name`, async ({ request, params }) => {
      const { url } = await record(request)
      const name = String(params.name)
      const spec = REPORT_SPECS[name]
      if (!spec) return notFound()
      const groupBy = url.searchParams.get('group_by')
      if (groupBy !== null && !spec.groups.includes(groupBy))
        return error(422, 'VALIDATION_ERROR', 'Geçersiz gruplama.', {
          group_by: ['Geçersiz gruplama.'],
        })
      const period = url.searchParams.get('period')
      if (
        period !== null &&
        (name !== 'purchases-by-period' || !['day', 'week', 'month'].includes(period))
      )
        return error(422, 'VALIDATION_ERROR', 'Geçersiz dönem.', { period: ['Geçersiz dönem.'] })
      const unknown = [...url.searchParams.keys()].find((k) => !REPORT_PARAMS.includes(k))
      if (unknown)
        return error(422, 'VALIDATION_ERROR', 'Bilinmeyen parametre.', {
          [unknown]: ['Bilinmeyen parametre.'],
        })
      const r = db.reports[name] ?? { rows: [] }
      const page = paginate(r.rows, url, 100)
      return HttpResponse.json({
        data: page.data,
        meta: { ...(r.meta ?? {}), pagination: page.meta.pagination },
      })
    }),
  ]
}
