import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import type { Item } from '@/features/catalog'
import type { Party } from '@/features/parties'
import type { Currency, PaymentTerm, TaxCode, Warehouse } from '@/features/reference'
import type {
  ApiAuditRow,
  RfqComparison,
  RfqQuote,
  WireLink,
  WireOrder,
  WireOrderLine,
  WireRequest,
  WireRfq,
  WireWarning,
} from '../types'

// In-memory stand-in for the Purchasing request / RFQ / order API (backend Modules/Purchasing:
// RequestResource, RfqResource, DocumentResource, LineResource, DocumentLinks, RfqService
// comparison and award, conversion bounds, preview-totals, supplier exposure) plus the lookups the
// screens read (parties, Catalog, Reference, settings, approvals, files). Documents are stored in
// the API's shape. Errors use {errors: {message, code, fields?}}.

const API = '*/api/v1'

export const COMPANY_CURRENCY = 'TRY'
export const SUP_ACME = 'sup-acme'
export const SUP_BETA = 'sup-beta'
export const CUSTOMER = 'cus-only'
export const ITEM_BOLT = 'item-bolt'
export const ITEM_SERVICE = 'item-service'
export const UNIT_PCS = 'unit-pcs'
export const UNIT_BOX = 'unit-box'
export const UNIT_HOUR = 'unit-hour'
export const TAX_20 = 'tax-kdv20'
export const TAX_10 = 'tax-kdv10'
export const WHT_5_10 = 'tax-tev510'
export const WH_MAIN = 'wh-main'
export const REQ_DRAFT = 'r-draft'
export const REQ_APPROVED = 'r-approved'
export const RFQ_DRAFT = 'q-draft'
export const RFQ_COLLECTING = 'q-collecting'
export const ORDER_DRAFT = 'o-draft'
export const ORDER_APPROVED = 'o-approved'
export const ORDER_SENT = 'o-sent'
export const APPROVAL_ID = 'apr-1'

export interface PurchCall {
  method: string
  path: string
  body: unknown
  url: URL
  headers: Headers
}

export interface PurchDb {
  permissions: string[]
  parties: Party[]
  items: Item[]
  units: { id: string; code: string; name: string }[]
  itemUnits: { item_id: string; unit_id: string; factor: string }[]
  taxCodes: TaxCode[]
  currencies: Currency[]
  paymentTerms: PaymentTerm[]
  warehouses: Warehouse[]
  requests: WireRequest[]
  rfqs: WireRfq[]
  orders: WireOrder[]
  /** Open payables per supplier (company currency), overdue part. */
  payables: Record<string, { open: string; overdue: string }>
  /** purchasing.require_approval_over / request_approval_over; null = never. */
  orderApprovalOver: string | null
  requestApprovalOver: string | null
  overReceiptPercent: string
  settingsReadable: boolean
  /** Documents created by the order conversions. */
  receipts: { id: string; order_id: string; lines: { order_line_id: string; quantity: string }[] }[]
  invoices: {
    id: string
    order_id: string
    receive_on_invoice: boolean
    lines: { order_line_id: string; quantity: string }[]
  }[]
  calls: PurchCall[]
  idempotency: Map<string, { status: number; body: unknown }>
  /** Paths whose next POST does the work but loses the response (network error). */
  dropNext: string[]
  /** Milliseconds a POST to these paths takes. */
  delay: Record<string, number>
  seq: number
}

const now = '2026-10-22T08:00:00Z'
const dec = (v: unknown) =>
  typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? new Decimal(v) : new Decimal(0)
const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(4)
const qty6 = (d: Decimal) => d.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

function paginate<T>(rows: T[], url: URL) {
  const perPage = Math.min(100, Number(url.searchParams.get('per_page') ?? 25) || 25)
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1)
  return {
    data: rows.slice((page - 1) * perPage, page * perPage),
    meta: {
      pagination: {
        current_page: page,
        per_page: perPage,
        total: rows.length,
        last_page: Math.max(1, Math.ceil(rows.length / perPage)),
      },
    },
  }
}

function error(status: number, code: string, message: string, fields?: Record<string, string[]>) {
  return HttpResponse.json({ errors: { message, code, ...(fields ? { fields } : {}) } }, { status })
}

const party = (over: Partial<Party> & Pick<Party, 'id' | 'code' | 'name'>): Party => ({
  legal_name: null,
  type: 'company',
  roles: ['supplier'],
  tax_office: 'Kadıköy',
  tax_number: '1234567890',
  country: 'TR',
  default_currency_code: 'TRY',
  payment_term_id: null,
  price_list_id: null,
  risk_limit: null,
  risk_currency_code: null,
  is_active: true,
  notes: null,
  tags: [],
  version: 1,
  ...over,
})

const item = (over: Partial<Item> & Pick<Item, 'id' | 'code' | 'name'>): Item => ({
  type: 'stock',
  base_unit_id: UNIT_PCS,
  category_id: null,
  default_tax_code_id: TAX_20,
  purchase_tax_code_id: null,
  tracking: 'none',
  has_expiry: false,
  min_stock: null,
  reorder_point: null,
  is_active: true,
  attributes: {},
  version: 1,
  ...over,
})

const tax = (id: string, code: string, rate: string, over: Partial<TaxCode> = {}): TaxCode => ({
  id,
  company_id: null,
  type: 'vat',
  code,
  name: code,
  rate,
  numerator: null,
  denominator: null,
  effective_from: '2020-01-01',
  effective_to: null,
  is_active: true,
  version: 1,
  ...over,
})

const currency = (code: string, name: string, symbol: string): Currency => ({
  id: `cur-${code}`,
  code,
  name,
  symbol,
  decimals: 2,
  is_active: true,
  company_is_active: true,
  company_version: 1,
  version: 1,
})

export const audit = (event: string): ApiAuditRow => ({
  event,
  description: event,
  causer_id: 'u1',
  created_at: now,
  properties: null,
})

const supplierName: Record<string, string> = {
  [SUP_ACME]: 'Acme Tedarik A.Ş.',
  [SUP_BETA]: 'Beta Endüstri Ltd.',
}

/** Order line totals like the TotalsEngine (2-decimal rounding per line, withholding of VAT). */
function computeLine(
  db: Pick<PurchDb, 'taxCodes'>,
  input: {
    quantity: string
    unit_price: string
    discount_percent?: string | null
    discount_amount?: string | null
    tax_code_id: string | null
    withholding_code_id?: string | null
  },
) {
  const gross = dec(input.quantity)
    .mul(dec(input.unit_price))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  const lineDiscount = gross
    .mul(dec(input.discount_percent ?? '0'))
    .div(100)
    .plus(dec(input.discount_amount ?? '0'))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  const net = gross.minus(lineDiscount)
  const vat = db.taxCodes.find((c) => c.id === input.tax_code_id)
  const rate = dec(vat?.rate ?? '0')
  const taxAmount = net.mul(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  const wht = db.taxCodes.find((c) => c.id === input.withholding_code_id)
  const whtRate =
    wht?.numerator && wht.denominator
      ? new Decimal(wht.numerator).div(wht.denominator).mul(100)
      : new Decimal(0)
  const withholding = taxAmount.mul(whtRate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  return {
    gross,
    lineDiscount,
    net,
    rate,
    taxAmount,
    whtRate,
    withholding,
    total: net.plus(taxAmount),
  }
}

function orderLine(
  db: Pick<PurchDb, 'taxCodes'>,
  docId: string,
  no: number,
  over: Partial<WireOrderLine> & { unit_price: string; quantity: string },
): WireOrderLine {
  const base: WireOrderLine = {
    id: `${docId}-l${no}`,
    line_no: no,
    item_id: ITEM_BOLT,
    variant_id: null,
    item_type: 'stock',
    description: null,
    unit_id: UNIT_PCS,
    base_quantity: '0',
    tax_inclusive: false,
    discount_percent: '0.0000',
    discount_amount: '0.0000',
    gross_amount: '0',
    line_discount: '0',
    net_amount: '0',
    tax_code_id: TAX_20,
    tax_rate: '0',
    tax_amount: '0',
    withholding_code_id: null,
    withholding_rate: '0.0000',
    withholding_amount: '0.0000',
    line_total: '0',
    warehouse_id: null,
    source_line_id: null,
    price_source: 'manual',
    received_quantity: '0.000000',
    invoiced_quantity: '0.000000',
    request_line_id: null,
    rfq_line_id: null,
    expected_date: null,
    ...over,
  }
  const c = computeLine(db, base)
  return {
    ...base,
    quantity: qty6(dec(base.quantity)),
    base_quantity: base.base_quantity === '0' ? qty6(dec(base.quantity)) : base.base_quantity,
    unit_price: qty6(dec(base.unit_price)),
    gross_amount: money(c.gross),
    line_discount: money(c.lineDiscount),
    net_amount: money(c.net),
    tax_rate: qty6(c.rate),
    tax_amount: money(c.taxAmount),
    withholding_rate: c.whtRate.toFixed(4),
    withholding_amount: money(c.withholding),
    line_total: money(c.total),
  }
}

/** Header totals of an order from its lines. */
function totals(lines: WireOrderLine[], fx: Decimal) {
  const sum = (pick: (l: WireOrderLine) => string) =>
    lines.reduce((acc, l) => acc.plus(dec(pick(l))), new Decimal(0))
  const subtotal = sum((l) => l.gross_amount)
  const discount = sum((l) => l.line_discount)
  const taxTotal = sum((l) => l.tax_amount)
  const wht = sum((l) => l.withholding_amount)
  const total = sum((l) => l.line_total)
  return {
    subtotal: money(subtotal),
    discount_total: money(discount),
    tax_total: money(taxTotal),
    withholding_total: money(wht),
    total: money(total),
    subtotal_local: money(subtotal.mul(fx)),
    discount_total_local: money(discount.mul(fx)),
    tax_total_local: money(taxTotal.mul(fx)),
    withholding_total_local: money(wht.mul(fx)),
    total_local: money(total.mul(fx)),
  }
}

function order(
  over: Partial<WireOrder> & Pick<WireOrder, 'id' | 'status'>,
  lines: WireOrderLine[],
): WireOrder {
  return {
    document_type: 'purchase_order',
    number: null,
    document_date: '2026-10-20',
    party_id: SUP_ACME,
    party_name: supplierName[SUP_ACME] ?? '',
    party_tax_office: 'Kadıköy',
    party_tax_number: '1234567890',
    billing_address: null,
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
    expected_date: null,
    supplier_reference: null,
    request_id: null,
    rfq_id: null,
    revision: 0,
    approval_request_id: null,
    approval_comment: null,
    approved_at: null,
    approved_by: null,
    sent_at: null,
    cancelled_at: null,
    closed_at: null,
    version: 1,
    created_by: 'u1',
    created_at: now,
    updated_at: now,
    ...totals(lines, new Decimal(1)),
    lines,
    audit: [audit('created')],
    ...over,
  }
}

export function createPurchDb(overrides: Partial<PurchDb> = {}): PurchDb {
  const taxCodes = [
    tax(TAX_20, 'KDV20', '20.000000'),
    tax(TAX_10, 'KDV10', '10.000000'),
    tax(WHT_5_10, 'TEV5/10', '0.000000', { type: 'withholding', numerator: 5, denominator: 10 }),
  ]
  const ctx = { taxCodes }
  const reqLine = (
    doc: string,
    no: number,
    over: Partial<NonNullable<WireRequest['lines']>[number]>,
  ) => ({
    id: `${doc}-l${no}`,
    line_no: no,
    item_id: ITEM_BOLT,
    variant_id: null,
    item_type: 'stock' as const,
    description: null,
    quantity: '10.000000',
    unit_id: UNIT_PCS,
    base_quantity: '10.000000',
    estimated_price: '9.500000',
    estimated_total: '95.0000',
    suggested_supplier_id: null,
    needed_by: null,
    warehouse_id: null,
    ...over,
  })
  const request = (
    over: Partial<WireRequest> & Pick<WireRequest, 'id' | 'status'>,
  ): WireRequest => ({
    document_type: 'purchase_request',
    number: null,
    document_date: '2026-10-20',
    needed_by: '2026-11-01',
    requested_by: 'u1',
    warehouse_id: WH_MAIN,
    cost_center_id: null,
    project_id: null,
    currency_code: 'TRY',
    notes: null,
    internal_notes: null,
    estimated_total: '95.0000',
    approval_request_id: null,
    approval_comment: null,
    submitted_at: null,
    approved_at: null,
    rejected_at: null,
    cancelled_at: null,
    version: 1,
    created_by: 'u1',
    created_at: now,
    updated_at: now,
    audit: [audit('created')],
    ...over,
  })
  const rfqLine = (
    doc: string,
    no: number,
    over: Partial<NonNullable<WireRfq['lines']>[number]> = {},
  ) => ({
    id: `${doc}-l${no}`,
    line_no: no,
    item_id: ITEM_BOLT,
    variant_id: null,
    item_type: 'stock' as const,
    description: null,
    quantity: '10.000000',
    unit_id: UNIT_PCS,
    base_quantity: '10.000000',
    request_line_id: null,
    needed_by: null,
    awarded_party_id: null,
    awarded_quote_id: null,
    ...over,
  })
  const rfq = (over: Partial<WireRfq> & Pick<WireRfq, 'id' | 'status'>): WireRfq => ({
    document_type: 'purchase_rfq',
    number: null,
    document_date: '2026-10-20',
    response_due: '2026-10-30',
    request_id: null,
    currency_code: 'TRY',
    warehouse_id: WH_MAIN,
    notes: null,
    internal_notes: null,
    sent_at: null,
    awarded_at: null,
    awarded_by: null,
    cancelled_at: null,
    version: 1,
    created_by: 'u1',
    created_at: now,
    updated_at: now,
    audit: [audit('created')],
    ...over,
  })
  const quote = (
    id: string,
    line: string,
    partyId: string,
    price: string,
    lead: number | null,
  ): RfqQuote => ({
    id,
    rfq_line_id: line,
    party_id: partyId,
    unit_price: qty6(dec(price)),
    discount_percent: '0.0000',
    net_unit_price: qty6(dec(price)),
    lead_time_days: lead,
    valid_until: null,
    notes: null,
  })
  return {
    permissions: [],
    parties: [
      party({ id: SUP_ACME, code: 'S0001', name: supplierName[SUP_ACME] ?? '' }),
      party({
        id: SUP_BETA,
        code: 'S0002',
        name: supplierName[SUP_BETA] ?? '',
        default_currency_code: 'EUR',
      }),
      party({ id: CUSTOMER, code: 'C0001', name: 'Sadece Müşteri', roles: ['customer'] }),
    ],
    items: [
      item({
        id: ITEM_BOLT,
        code: 'CVT-01',
        name: 'Cıvata M8',
        purchase_tax_code_id: TAX_10,
        base_unit: { id: UNIT_PCS, code: 'ADET', name: 'Adet', symbol: null },
      }),
      item({
        id: ITEM_SERVICE,
        code: 'NAK-01',
        name: 'Nakliye hizmeti',
        type: 'service',
        base_unit_id: UNIT_HOUR,
      }),
    ],
    units: [
      { id: UNIT_PCS, code: 'ADET', name: 'Adet' },
      { id: UNIT_BOX, code: 'KOLI', name: 'Koli' },
      { id: UNIT_HOUR, code: 'SAAT', name: 'Saat' },
    ],
    itemUnits: [{ item_id: ITEM_BOLT, unit_id: UNIT_BOX, factor: '12.000000' }],
    taxCodes,
    currencies: [currency('TRY', 'Türk lirası', '₺'), currency('EUR', 'Euro', '€')],
    paymentTerms: [
      {
        id: 'pt-30',
        code: 'V30',
        name: '30 gün',
        due_days: 30,
        discount_percent: null,
        discount_days: null,
        is_active: true,
        version: 1,
      },
    ],
    warehouses: [
      {
        id: WH_MAIN,
        code: 'ANA',
        name: 'Ana depo',
        branch_id: null,
        address: null,
        is_active: true,
        negative_stock_policy: 'block',
        is_default: true,
        version: 1,
      },
    ],
    requests: [
      request({ id: REQ_DRAFT, status: 'draft', lines: [reqLine(REQ_DRAFT, 1, {})] }),
      request({
        id: REQ_APPROVED,
        status: 'partially_ordered',
        number: 'PRQ2026000000001',
        estimated_total: '145.0000',
        lines: [
          reqLine(REQ_APPROVED, 1, { suggested_supplier_id: SUP_ACME }),
          reqLine(REQ_APPROVED, 2, {
            item_id: ITEM_SERVICE,
            item_type: 'service',
            unit_id: UNIT_HOUR,
            quantity: '2.000000',
            base_quantity: '2.000000',
            estimated_price: '25.000000',
            estimated_total: '50.0000',
            suggested_supplier_id: SUP_ACME,
          }),
        ],
        ordered_quantities: { [`${REQ_APPROVED}-l1`]: '4.000000', [`${REQ_APPROVED}-l2`]: '0' },
      }),
    ],
    rfqs: [
      rfq({
        id: RFQ_DRAFT,
        status: 'draft',
        lines: [rfqLine(RFQ_DRAFT, 1)],
        suppliers: [
          {
            party_id: SUP_ACME,
            party_name: supplierName[SUP_ACME] ?? '',
            status: 'invited',
            responded_at: null,
          },
        ],
        quotes: [],
      }),
      rfq({
        id: RFQ_COLLECTING,
        status: 'collecting',
        number: 'RFQ2026000000001',
        sent_at: now,
        lines: [
          rfqLine(RFQ_COLLECTING, 1),
          rfqLine(RFQ_COLLECTING, 2, {
            item_id: ITEM_SERVICE,
            item_type: 'service',
            unit_id: UNIT_HOUR,
            quantity: '5.000000',
            base_quantity: '5.000000',
          }),
        ],
        suppliers: [
          {
            party_id: SUP_ACME,
            party_name: supplierName[SUP_ACME] ?? '',
            status: 'responded',
            responded_at: now,
          },
          {
            party_id: SUP_BETA,
            party_name: supplierName[SUP_BETA] ?? '',
            status: 'responded',
            responded_at: now,
          },
        ],
        quotes: [
          quote('qt-1', `${RFQ_COLLECTING}-l1`, SUP_ACME, '9', 5),
          quote('qt-2', `${RFQ_COLLECTING}-l2`, SUP_ACME, '100', 3),
          quote('qt-3', `${RFQ_COLLECTING}-l1`, SUP_BETA, '8.5', 10),
        ],
      }),
    ],
    orders: [
      order({ id: ORDER_DRAFT, status: 'draft' }, [
        orderLine(ctx, ORDER_DRAFT, 1, { quantity: '10', unit_price: '12.5' }),
      ]),
      order(
        { id: ORDER_APPROVED, status: 'approved', number: 'POR2026000000001', approved_at: now },
        [orderLine(ctx, ORDER_APPROVED, 1, { quantity: '5', unit_price: '20' })],
      ),
      order(
        { id: ORDER_SENT, status: 'partially_invoiced', number: 'POR2026000000002', sent_at: now },
        [
          orderLine(ctx, ORDER_SENT, 1, {
            quantity: '10',
            unit_price: '12.5',
            received_quantity: '4.000000',
            invoiced_quantity: '2.000000',
          }),
          orderLine(ctx, ORDER_SENT, 2, {
            item_id: ITEM_SERVICE,
            item_type: 'service',
            unit_id: UNIT_HOUR,
            quantity: '3',
            unit_price: '100',
            invoiced_quantity: '1.000000',
          }),
        ],
      ),
    ],
    payables: { [SUP_ACME]: { open: '1200.0000', overdue: '0.0000' } },
    orderApprovalOver: null,
    requestApprovalOver: null,
    overReceiptPercent: '10',
    settingsReadable: true,
    receipts: [],
    invoices: [],
    calls: [],
    idempotency: new Map(),
    dropNext: [],
    delay: {},
    seq: 0,
    ...overrides,
  }
}

type Body = Record<string, unknown>

/** The first fixture row (new documents copy its defaults). */
function first<T>(rows: T[]): T {
  const row = rows[0]
  if (row === undefined) throw new Error('fixture rows missing')
  return row
}

const link = (
  doc: {
    id: string
    document_type: string
    number: string | null
    status: string
    document_date: string
    currency_code: string
  },
  total: string | null,
): WireLink => ({
  id: doc.id,
  document_type: doc.document_type as WireLink['document_type'],
  number: doc.number,
  status: doc.status,
  document_date: doc.document_date,
  total,
  currency_code: doc.currency_code,
})

export function purchHandlers(db: PurchDb) {
  const record = http.all(`${API}/*`, async ({ request }) => {
    const url = new URL(request.url)
    let body: unknown = null
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      body = await request
        .clone()
        .json()
        .catch(() => null)
    }
    db.calls.push({
      method: request.method,
      path: url.pathname.replace(/^.*\/api\/v1/, ''),
      body,
      url,
      headers: request.headers,
    })
    return undefined
  })

  const can = (p: string) => db.permissions.includes(p)
  const json = async (request: Request) => ((await request.json().catch(() => ({}))) ?? {}) as Body
  const conflict = () => error(409, 'VERSION_CONFLICT', 'Belge başka biri tarafından değiştirildi.')
  const illegal = () =>
    error(422, 'INVALID_STATE_TRANSITION', 'Bu işlem belgenin durumunda yapılamaz.')
  // DocumentService::assertEditable: edit or delete past draft, answered before the version check.
  const locked = () => error(409, 'DOCUMENT_LOCKED', 'Yalnızca taslak belgeler düzenlenebilir.')
  const invalid = (fields: Record<string, string[]>) =>
    error(422, 'VALIDATION_ERROR', 'Belge doğrulanamadı.', fields)
  const forbidden = () => error(403, 'FORBIDDEN', 'Yetkiniz yok.')
  const stale = (doc: { version: number }, body: Body) =>
    typeof body.version === 'number' && body.version !== doc.version
  const touch = (doc: { version: number; audit?: ApiAuditRow[] }, event: string) => {
    doc.version += 1
    doc.audit = [...(doc.audit ?? []), audit(event)]
  }
  const nextNumber = (prefix: string) => `${prefix}2026${String(++db.seq).padStart(9, '0')}`

  /** Replays a stored response for a reused Idempotency-Key; drops a response when asked. */
  async function idempotent(
    request: Request,
    path: string,
    run: () => Promise<Response> | Response,
  ) {
    const key = request.headers.get('Idempotency-Key')
    if (key && db.idempotency.has(key)) {
      const stored = db.idempotency.get(key)
      return HttpResponse.json(stored?.body as Record<string, unknown>, { status: stored?.status })
    }
    const wait = db.delay[path]
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    const res = await run()
    if (key && res.status < 500) {
      const body: unknown = await res
        .clone()
        .json()
        .catch(() => null)
      db.idempotency.set(key, { status: res.status, body })
    }
    const drop = db.dropNext.indexOf(path)
    if (drop >= 0) {
      db.dropNext.splice(drop, 1)
      return HttpResponse.error()
    }
    return res
  }

  // ---- links -------------------------------------------------------------------------------
  const orderLinks = (o: WireOrder) => ({
    request: can('purchasing.requests.view')
      ? (() => {
          const r = db.requests.find((x) => x.id === o.request_id)
          return r ? link(r, r.estimated_total) : null
        })()
      : null,
    rfq: (() => {
      const q = db.rfqs.find((x) => x.id === o.rfq_id)
      return q ? link(q, null) : null
    })(),
    receipts: db.receipts
      .filter((r) => r.order_id === o.id)
      .map((r) => ({
        id: r.id,
        document_type: 'purchase_receipt' as const,
        number: null,
        status: 'draft',
        document_date: '2026-10-22',
        total: null,
        currency_code: o.currency_code,
      })),
    invoices: db.invoices
      .filter((r) => r.order_id === o.id)
      .map((r) => ({
        id: r.id,
        document_type: 'purchase_invoice' as const,
        number: null,
        status: 'draft',
        document_date: '2026-10-22',
        total: null,
        currency_code: o.currency_code,
      })),
  })
  const detail = {
    request: (r: WireRequest) => ({
      ...r,
      links: {
        rfqs: db.rfqs.filter((q) => q.request_id === r.id).map((q) => link(q, null)),
        orders: db.orders.filter((o) => o.request_id === r.id).map((o) => link(o, o.total)),
      },
    }),
    rfq: (q: WireRfq) => ({
      ...q,
      links: {
        request: (() => {
          const r = db.requests.find((x) => x.id === q.request_id)
          return r ? link(r, r.estimated_total) : null
        })(),
        orders: db.orders.filter((o) => o.rfq_id === q.id).map((o) => link(o, o.total)),
      },
    }),
    order: (o: WireOrder) => ({ ...o, links: orderLinks(o) }),
  }
  /** Action / save responses carry no links or audit (like the API's respond()). */
  const bare = (doc: object) => {
    const out = { ...doc } as Record<string, unknown>
    delete out.links
    delete out.audit
    delete out.ordered_quantities
    return out
  }

  // ---- order composition ---------------------------------------------------------------------
  function composeOrder(id: string, body: Body, stored?: WireOrder) {
    const fields: Record<string, string[]> = {}
    const partyId = str(body.party_id) ?? stored?.party_id ?? ''
    const p = db.parties.find((x) => x.id === partyId)
    if (!p?.roles.includes('supplier')) fields.party_id = ['Tedarikçi bulunamadı.']
    const raw = Array.isArray(body.lines) ? (body.lines as Body[]) : null
    const lines: WireOrderLine[] = raw
      ? raw.map((l, i) => {
          const keep = stored?.lines?.find((x) => x.id === l.id)
          if (!db.items.some((it) => it.id === l.item_id))
            fields[`lines.${i}.item_id`] = ['Stok kartı bulunamadı.']
          if (!dec(l.quantity).gt(0))
            fields[`lines.${i}.quantity`] = ['Miktar sıfırdan büyük olmalı.']
          if (typeof l.unit_price !== 'string') fields[`lines.${i}.unit_price`] = ['Fiyat girin.']
          const it = db.items.find((x) => x.id === l.item_id)
          return orderLine({ taxCodes: db.taxCodes }, id, i + 1, {
            id: keep?.id ?? `${id}-n${++db.seq}`,
            item_id: str(l.item_id) ?? '',
            item_type: it?.type ?? 'stock',
            unit_id: str(l.unit_id) ?? '',
            quantity: str(l.quantity) ?? '0',
            unit_price: str(l.unit_price) ?? '0',
            discount_percent: str(l.discount_percent) ?? '0',
            discount_amount: str(l.discount_amount) ?? '0',
            tax_code_id:
              (l.tax_code_id as string | null | undefined) === undefined
                ? (it?.purchase_tax_code_id ?? it?.default_tax_code_id ?? null)
                : (l.tax_code_id as string | null),
            withholding_code_id: (l.withholding_code_id as string | null | undefined) ?? null,
            description: str(l.description),
            expected_date: str(l.expected_date),
            price_source: keep?.price_source ?? 'manual',
            request_line_id: keep?.request_line_id ?? null,
            rfq_line_id: keep?.rfq_line_id ?? null,
          })
        })
      : (stored?.lines ?? [])
    if (lines.length === 0) fields.lines = ['En az bir satır girin.']
    const currencyCode =
      str(body.currency_code) ?? stored?.currency_code ?? p?.default_currency_code ?? 'TRY'
    const fx = str(body.fx_rate)
      ? dec(body.fx_rate)
      : currencyCode === COMPANY_CURRENCY
        ? new Decimal(1)
        : new Decimal('35.5')
    return {
      fields,
      parts: {
        party_id: partyId,
        party_name: p?.name ?? '',
        document_date: str(body.document_date) ?? stored?.document_date ?? '2026-10-22',
        currency_code: currencyCode,
        fx_rate: qty6(fx),
        payment_term_id:
          body.payment_term_id === undefined
            ? (stored?.payment_term_id ?? null)
            : str(body.payment_term_id),
        warehouse_id:
          body.warehouse_id === undefined ? (stored?.warehouse_id ?? null) : str(body.warehouse_id),
        expected_date:
          body.expected_date === undefined
            ? (stored?.expected_date ?? null)
            : str(body.expected_date),
        supplier_reference:
          body.supplier_reference === undefined
            ? (stored?.supplier_reference ?? null)
            : str(body.supplier_reference),
        notes: body.notes === undefined ? (stored?.notes ?? null) : str(body.notes),
        internal_notes:
          body.internal_notes === undefined
            ? (stored?.internal_notes ?? null)
            : str(body.internal_notes),
        ...totals(lines, fx),
        lines,
      },
    }
  }

  const submitOrder = (o: WireOrder) => {
    o.number ??= nextNumber('POR')
    o.approval_comment = null
    if (db.orderApprovalOver !== null && dec(o.total_local).gte(dec(db.orderApprovalOver))) {
      o.status = 'pending_approval'
      o.approval_request_id = APPROVAL_ID
    } else {
      o.status = o.sent_at ? 'sent' : 'approved'
      o.approved_at = now
    }
  }

  const hasDocuments = (o: WireOrder) =>
    db.receipts.some((r) => r.order_id === o.id) ||
    db.invoices.some((r) => r.order_id === o.id) ||
    (o.lines ?? []).some((l) => dec(l.received_quantity).gt(0) || dec(l.invoiced_quantity).gt(0))

  const OPEN = ['approved', 'sent', 'partially_received', 'received', 'partially_invoiced']

  const listOf = <T extends { status: string; document_date: string; number: string | null }>(
    rows: T[],
    url: URL,
    supplierOf: (r: T) => string[],
    itemsOf: (r: T) => string[],
  ) => {
    const s = url.searchParams
    const out = rows.filter((r) => {
      const status = s.get('filter[status]')
      if (status && !status.split(',').includes(r.status)) return false
      const sup = s.get('filter[supplier]')
      if (sup && !supplierOf(r).includes(sup)) return false
      if (s.get('filter[date_from]') && r.document_date < (s.get('filter[date_from]') ?? ''))
        return false
      if (s.get('filter[date_to]') && r.document_date > (s.get('filter[date_to]') ?? ''))
        return false
      if (s.get('filter[number]') && !(r.number ?? '').includes(s.get('filter[number]') ?? ''))
        return false
      const item = s.get('filter[item_id]')
      if (item && !itemsOf(r).includes(item)) return false
      return true
    })
    return paginate(out, url)
  }

  const csv = (name: string) =>
    new HttpResponse('number;status\n', {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${name}.csv"`,
      },
    })

  const comparison = (q: WireRfq): RfqComparison => {
    const totalsBy = new Map<string, { total: Decimal; lines: number }>()
    const lines = (q.lines ?? []).map((l) => {
      const rows = (q.quotes ?? []).filter((x) => x.rfq_line_id === l.id)
      const nets = rows.map((x) =>
        dec(x.unit_price).mul(new Decimal(1).minus(dec(x.discount_percent).div(100))),
      )
      const lowest = nets.length ? Decimal.min(...nets) : null
      const leads = rows.map((x) => x.lead_time_days).filter((x): x is number => x !== null)
      const fastest = leads.length ? Math.min(...leads) : null
      const quotes = rows
        .map((x, i) => {
          const net = nets[i] ?? new Decimal(0)
          const total = net.mul(dec(l.quantity)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          const t = totalsBy.get(x.party_id) ?? { total: new Decimal(0), lines: 0 }
          totalsBy.set(x.party_id, { total: t.total.plus(total), lines: t.lines + 1 })
          return {
            quote_id: x.id,
            party_id: x.party_id,
            party_name: q.suppliers?.find((s) => s.party_id === x.party_id)?.party_name ?? null,
            unit_price: x.unit_price,
            discount_percent: x.discount_percent,
            net_unit_price: qty6(net),
            line_total: total.toFixed(2),
            lead_time_days: x.lead_time_days,
            valid_until: x.valid_until,
            notes: x.notes,
            lowest_price: lowest !== null && net.eq(lowest),
            fastest: fastest !== null && x.lead_time_days === fastest,
          }
        })
        .map((row, i) => ({ row, net: nets[i] ?? new Decimal(0) }))
        .sort((a, b) => a.net.comparedTo(b.net))
        .map(({ row }) => row)
      return {
        rfq_line_id: l.id,
        line_no: l.line_no,
        item_id: l.item_id,
        description: l.description,
        quantity: l.quantity,
        unit_id: l.unit_id,
        awarded_party_id: l.awarded_party_id,
        quotes,
      }
    })
    const best: { party: string | null; total: Decimal | null } = { party: null, total: null }
    const suppliers = (q.suppliers ?? []).map((s) => {
      const t = totalsBy.get(s.party_id)
      const complete = t?.lines === lines.length
      if (t && complete && (best.total === null || t.total.lt(best.total))) {
        best.party = s.party_id
        best.total = t.total
      }
      return {
        party_id: s.party_id,
        party_name: s.party_name,
        status: s.status,
        lines_quoted: t?.lines ?? 0,
        total: t ? t.total.toFixed(2) : null,
        complete,
      }
    })
    return {
      rfq_id: q.id,
      currency_code: q.currency_code,
      lines,
      suppliers,
      lowest_total_party_id: best.party,
    }
  }

  return [
    record,
    // ---- lookups ---------------------------------------------------------------------------
    http.get(`${API}/parties`, ({ request }) => {
      const url = new URL(request.url)
      const q = (url.searchParams.get('q') ?? '').toLocaleLowerCase('tr')
      const role = url.searchParams.get('filter[role]')
      const rows = db.parties.filter(
        (p) =>
          (!role || p.roles.includes(role as Party['roles'][number])) &&
          (q === '' ||
            p.name.toLocaleLowerCase('tr').includes(q) ||
            p.code.toLowerCase().includes(q)),
      )
      return HttpResponse.json(paginate(rows, url))
    }),
    http.get(`${API}/parties/:id`, ({ params }) => {
      const p = db.parties.find((x) => x.id === params.id)
      return p ? HttpResponse.json({ data: p }) : error(404, 'NOT_FOUND', 'Bulunamadı.')
    }),
    http.get(`${API}/items`, ({ request }) => {
      const url = new URL(request.url)
      const q = (url.searchParams.get('q') ?? '').toLocaleLowerCase('tr')
      const ids = url.searchParams.get('filter[id]')?.split(',')
      const rows = db.items.filter(
        (i) =>
          (!ids || ids.includes(i.id)) &&
          (q === '' ||
            i.name.toLocaleLowerCase('tr').includes(q) ||
            i.code.toLowerCase().includes(q)),
      )
      return HttpResponse.json(paginate(rows, url))
    }),
    http.get(`${API}/items/:id/units`, ({ request, params }) =>
      HttpResponse.json(
        paginate(
          db.itemUnits
            .filter((u) => u.item_id === params.id)
            .map((u, i) => ({ id: `iu-${i}`, ...u })),
          new URL(request.url),
        ),
      ),
    ),
    http.get(`${API}/items/:id`, ({ params }) => {
      const it = db.items.find((x) => x.id === params.id)
      return it ? HttpResponse.json({ data: it }) : error(404, 'NOT_FOUND', 'Bulunamadı.')
    }),
    http.get(`${API}/units`, ({ request }) =>
      HttpResponse.json(paginate(db.units, new URL(request.url))),
    ),
    http.get(`${API}/tax-codes`, ({ request }) => {
      const url = new URL(request.url)
      const type = url.searchParams.get('filter[type]')
      return HttpResponse.json(
        paginate(
          db.taxCodes.filter((c) => !type || c.type === type),
          url,
        ),
      )
    }),
    http.get(`${API}/currencies`, ({ request }) =>
      HttpResponse.json(paginate(db.currencies, new URL(request.url))),
    ),
    http.get(`${API}/payment-terms`, ({ request }) =>
      HttpResponse.json(paginate(db.paymentTerms, new URL(request.url))),
    ),
    http.get(`${API}/warehouses`, ({ request }) =>
      HttpResponse.json(paginate(db.warehouses, new URL(request.url))),
    ),
    http.get(`${API}/files`, ({ request }) =>
      HttpResponse.json(paginate([], new URL(request.url))),
    ),
    http.get(`${API}/approvals/:id`, ({ params }) =>
      HttpResponse.json({
        data: {
          id: params.id,
          status: 'pending',
          current_step: 1,
          amount: '0',
          steps: [{ position: 1, name: 'Satınalma müdürü' }],
          decisions: [],
        },
      }),
    ),
    http.get(`${API}/settings`, ({ request }) => {
      if (!db.settingsReadable) return forbidden()
      const group = new URL(request.url).searchParams.get('group')
      const rows = [
        {
          key: 'purchasing.allow_over_receipt_percent',
          group: 'purchasing',
          default: 0,
          value: Number(db.overReceiptPercent),
          is_default: false,
        },
      ]
      return HttpResponse.json({ data: rows.filter((r) => !group || r.group === group) })
    }),
    http.get(`${API}/suppliers/:id/exposure`, ({ params }) => {
      if (!can('purchasing.orders.view') && !can('purchasing.invoices.view')) return forbidden()
      const id = String(params.id)
      const pay = db.payables[id] ?? { open: '0', overdue: '0' }
      const openOrders = db.orders
        .filter((o) => o.party_id === id && OPEN.includes(o.status))
        .reduce((acc, o) => acc.plus(dec(o.total_local)), new Decimal(0))
      return HttpResponse.json({
        data: {
          party_id: id,
          currency: COMPANY_CURRENCY,
          open_payables: dec(pay.open).toFixed(2),
          open_orders: openOrders.toFixed(2),
          total: dec(pay.open).plus(openOrders).toFixed(2),
          overdue_payables: dec(pay.overdue).toFixed(2),
        },
      })
    }),
    // ---- preview -----------------------------------------------------------------------------
    http.post(`${API}/purchase-documents/preview-totals`, async ({ request }) => {
      const body = await json(request)
      const { fields, parts } = composeOrder('preview', body)
      if (Object.keys(fields).length > 0) return invalid(fields)
      const lines = parts.lines
      const taxes = new Map<
        string,
        { tax_code_id: string | null; rate: string; base: Decimal; tax: Decimal }
      >()
      for (const l of lines) {
        const k = l.tax_code_id ?? 'none'
        const row = taxes.get(k) ?? {
          tax_code_id: l.tax_code_id,
          rate: l.tax_rate,
          base: new Decimal(0),
          tax: new Decimal(0),
        }
        row.base = row.base.plus(dec(l.net_amount))
        row.tax = row.tax.plus(dec(l.tax_amount))
        taxes.set(k, row)
      }
      const warnings: WireWarning[] = []
      return HttpResponse.json({
        data: {
          header: { currency_code: parts.currency_code, fx_rate: parts.fx_rate },
          lines: lines.map((l) => ({
            unit_price: l.unit_price,
            price_source: 'manual',
            base_quantity: l.base_quantity,
            net_amount: l.net_amount,
            tax_code_id: l.tax_code_id,
            tax_rate: l.tax_rate,
            tax_amount: l.tax_amount,
            withholding_amount: l.withholding_amount,
            line_total: l.line_total,
          })),
          taxes: [...taxes.values()].map((t) => ({
            tax_code_id: t.tax_code_id,
            rate: t.rate,
            base: money(t.base),
            tax: money(t.tax),
          })),
          totals: {
            subtotal: parts.subtotal,
            discount_total: parts.discount_total,
            tax_total: parts.tax_total,
            withholding_total: parts.withholding_total,
            total: parts.total,
            total_local: parts.total_local,
          },
        },
        meta: warnings.length ? { warnings } : {},
      })
    }),
    // ---- requests ----------------------------------------------------------------------------
    http.get(`${API}/purchase-requests/export`, () => csv('talepler')),
    http.get(`${API}/purchase-requests`, ({ request }) =>
      HttpResponse.json(
        listOf(
          db.requests.map(bare) as unknown as WireRequest[],
          new URL(request.url),
          (r) =>
            (db.requests.find((x) => x.id === r.id)?.lines ?? []).map(
              (l) => l.suggested_supplier_id ?? '',
            ),
          (r) => (db.requests.find((x) => x.id === r.id)?.lines ?? []).map((l) => l.item_id),
        ),
      ),
    ),
    http.get(`${API}/purchase-requests/:id`, ({ params }) => {
      const r = db.requests.find((x) => x.id === params.id)
      return r
        ? HttpResponse.json({ data: detail.request(r) })
        : error(404, 'NOT_FOUND', 'Bulunamadı.')
    }),
    http.post(`${API}/purchase-requests`, ({ request }) =>
      idempotent(request, '/purchase-requests', async () => {
        const body = await json(request)
        const id = `r-new-${++db.seq}`
        const lines = (Array.isArray(body.lines) ? (body.lines as Body[]) : []).map((l, i) => ({
          id: `${id}-l${i + 1}`,
          line_no: i + 1,
          item_id: String(l.item_id),
          variant_id: null,
          item_type: db.items.find((x) => x.id === l.item_id)?.type ?? null,
          description: str(l.description),
          quantity: qty6(dec(l.quantity)),
          unit_id: String(l.unit_id),
          base_quantity: qty6(dec(l.quantity)),
          estimated_price: qty6(dec(l.estimated_price)),
          estimated_total: money(dec(l.quantity).mul(dec(l.estimated_price))),
          suggested_supplier_id: str(l.suggested_supplier_id),
          needed_by: str(l.needed_by),
          warehouse_id: str(l.warehouse_id),
        }))
        const doc: WireRequest = {
          ...first(db.requests),
          id,
          status: 'draft',
          number: null,
          document_date: str(body.document_date) ?? '2026-10-22',
          needed_by: str(body.needed_by),
          warehouse_id: str(body.warehouse_id),
          notes: str(body.notes),
          internal_notes: str(body.internal_notes),
          estimated_total: money(
            lines.reduce((a, l) => a.plus(dec(l.estimated_total)), new Decimal(0)),
          ),
          lines,
          version: 1,
          audit: [audit('created')],
          ordered_quantities: {},
        }
        db.requests.push(doc)
        return HttpResponse.json({ data: bare(doc) }, { status: 201 })
      }),
    ),
    http.patch(`${API}/purchase-requests/:id`, async ({ request, params }) => {
      const r = db.requests.find((x) => x.id === params.id)
      if (!r) return error(404, 'NOT_FOUND', 'Bulunamadı.')
      const body = await json(request)
      if (r.status !== 'draft' && r.status !== 'rejected') return locked()
      if (stale(r, body)) return conflict()
      r.status = 'draft'
      r.needed_by = body.needed_by === undefined ? r.needed_by : str(body.needed_by)
      r.notes = body.notes === undefined ? r.notes : str(body.notes)
      if (Array.isArray(body.lines)) {
        r.lines = (body.lines as Body[]).map((l, i) => ({
          ...(r.lines?.[0] ?? ({} as NonNullable<WireRequest['lines']>[number])),
          id: `${r.id}-e${++db.seq}`,
          line_no: i + 1,
          item_id: String(l.item_id),
          quantity: qty6(dec(l.quantity)),
          unit_id: String(l.unit_id),
          base_quantity: qty6(dec(l.quantity)),
          estimated_price: qty6(dec(l.estimated_price)),
          estimated_total: money(dec(l.quantity).mul(dec(l.estimated_price))),
          suggested_supplier_id: str(l.suggested_supplier_id),
        }))
      }
      touch(r, 'updated')
      return HttpResponse.json({ data: bare(r) })
    }),
    http.delete(`${API}/purchase-requests/:id`, ({ params }) => {
      const r = db.requests.find((x) => x.id === params.id)
      if (r && r.status !== 'draft' && r.status !== 'rejected') return locked()
      db.requests = db.requests.filter((x) => x.id !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/purchase-requests/:id/:action`, ({ request, params }) =>
      idempotent(request, `/purchase-requests/${String(params.action)}`, async () => {
        const r = db.requests.find((x) => x.id === params.id)
        if (!r) return error(404, 'NOT_FOUND', 'Bulunamadı.')
        const body = await json(request)
        const action = String(params.action)
        if (action === 'submit' || action === 'cancel') {
          if (!can('purchasing.requests.update')) return forbidden()
          if (stale(r, body)) return conflict()
          if (action === 'submit') {
            if (r.status !== 'draft') return illegal()
            r.number ??= nextNumber('PRQ')
            const pending =
              db.requestApprovalOver !== null &&
              dec(r.estimated_total).gte(dec(db.requestApprovalOver))
            r.status = pending ? 'pending_approval' : 'approved'
            if (pending) r.approval_request_id = APPROVAL_ID
          } else {
            if (['ordered', 'cancelled'].includes(r.status)) return illegal()
            r.status = 'cancelled'
          }
          touch(r, action)
          return HttpResponse.json({ data: bare(r) })
        }
        if (!['approved', 'partially_ordered'].includes(r.status))
          return invalid({ request: ['Talep açık değil.'] })
        const picks = Array.isArray(body.lines) ? (body.lines as Body[]) : []
        const fields: Record<string, string[]> = {}
        picks.forEach((p, i) => {
          const l = r.lines?.find((x) => x.id === p.request_line_id)
          const open = l
            ? dec(l.quantity).minus(dec(r.ordered_quantities?.[l.id] ?? '0'))
            : new Decimal(0)
          if (!l) fields[`lines.${i}.request_line_id`] = ['Kaynak satır bulunamadı.']
          else if (dec(p.quantity).gt(open))
            fields[`lines.${i}.quantity`] = [`Talepte kalan miktar ${open.toString()}.`]
        })
        if (Object.keys(fields).length) return invalid(fields)
        if (action === 'rfq') {
          const id = `q-new-${++db.seq}`
          const doc: WireRfq = {
            ...first(db.rfqs),
            id,
            request_id: r.id,
            status: 'draft',
            number: null,
            currency_code: str(body.currency_code) ?? r.currency_code,
            response_due: str(body.response_due),
            lines: picks.map((p, i) => {
              const src = r.lines?.find((x) => x.id === p.request_line_id)
              return {
                id: `${id}-l${i + 1}`,
                line_no: i + 1,
                item_id: src?.item_id ?? ITEM_BOLT,
                variant_id: null,
                item_type: src?.item_type ?? null,
                description: null,
                quantity: qty6(dec(p.quantity)),
                unit_id: src?.unit_id ?? UNIT_PCS,
                base_quantity: qty6(dec(p.quantity)),
                request_line_id: src?.id ?? null,
                needed_by: null,
                awarded_party_id: null,
                awarded_quote_id: null,
              }
            }),
            suppliers: ((body.supplier_ids as string[] | undefined) ?? []).map((sid) => ({
              party_id: sid,
              party_name: db.parties.find((x) => x.id === sid)?.name ?? '',
              status: 'invited' as const,
              responded_at: null,
            })),
            quotes: [],
            version: 1,
            audit: [audit('created')],
          }
          db.rfqs.push(doc)
          return HttpResponse.json({ data: bare(doc) }, { status: 201 })
        }
        const id = `o-new-${++db.seq}`
        const { parts } = composeOrder(id, {
          party_id: body.party_id,
          document_date: body.document_date,
          currency_code: body.currency_code,
          lines: picks.map((p) => {
            const src = r.lines?.find((x) => x.id === p.request_line_id)
            return {
              item_id: src?.item_id,
              unit_id: src?.unit_id,
              quantity: p.quantity,
              unit_price: str(p.unit_price) ?? src?.estimated_price ?? '0',
            }
          }),
        })
        const doc = order({ id, status: 'draft', request_id: r.id, ...parts }, parts.lines)
        db.orders.push(doc)
        for (const p of picks) {
          const key = String(p.request_line_id)
          r.ordered_quantities = {
            ...r.ordered_quantities,
            [key]: qty6(dec(r.ordered_quantities?.[key] ?? '0').plus(dec(p.quantity))),
          }
        }
        return HttpResponse.json({ data: bare(doc) }, { status: 201 })
      }),
    ),
    // ---- RFQs -------------------------------------------------------------------------------
    http.get(`${API}/purchase-rfqs/export`, () => csv('teklif-talepleri')),
    http.get(`${API}/purchase-rfqs`, ({ request }) =>
      HttpResponse.json(
        listOf(
          db.rfqs.map(bare) as unknown as WireRfq[],
          new URL(request.url),
          (q) => (db.rfqs.find((x) => x.id === q.id)?.suppliers ?? []).map((s) => s.party_id),
          (q) => (db.rfqs.find((x) => x.id === q.id)?.lines ?? []).map((l) => l.item_id),
        ),
      ),
    ),
    http.get(`${API}/purchase-rfqs/:id/comparison`, ({ params }) => {
      const q = db.rfqs.find((x) => x.id === params.id)
      return q ? HttpResponse.json({ data: comparison(q) }) : error(404, 'NOT_FOUND', 'Bulunamadı.')
    }),
    http.get(`${API}/purchase-rfqs/:id`, ({ params }) => {
      const q = db.rfqs.find((x) => x.id === params.id)
      return q ? HttpResponse.json({ data: detail.rfq(q) }) : error(404, 'NOT_FOUND', 'Bulunamadı.')
    }),
    http.post(`${API}/purchase-rfqs`, ({ request }) =>
      idempotent(request, '/purchase-rfqs', async () => {
        const body = await json(request)
        const id = `q-new-${++db.seq}`
        const doc: WireRfq = {
          ...first(db.rfqs),
          id,
          status: 'draft',
          number: null,
          document_date: str(body.document_date) ?? '2026-10-22',
          response_due: str(body.response_due),
          currency_code: str(body.currency_code) ?? 'TRY',
          lines: ((body.lines as Body[] | undefined) ?? []).map((l, i) => ({
            id: `${id}-l${i + 1}`,
            line_no: i + 1,
            item_id: String(l.item_id),
            variant_id: null,
            item_type: db.items.find((x) => x.id === l.item_id)?.type ?? null,
            description: str(l.description),
            quantity: qty6(dec(l.quantity)),
            unit_id: String(l.unit_id),
            base_quantity: qty6(dec(l.quantity)),
            request_line_id: null,
            needed_by: str(l.needed_by),
            awarded_party_id: null,
            awarded_quote_id: null,
          })),
          suppliers: ((body.supplier_ids as string[] | undefined) ?? []).map((sid) => ({
            party_id: sid,
            party_name: db.parties.find((x) => x.id === sid)?.name ?? '',
            status: 'invited' as const,
            responded_at: null,
          })),
          quotes: [],
          version: 1,
          audit: [audit('created')],
        }
        db.rfqs.push(doc)
        return HttpResponse.json({ data: bare(doc) }, { status: 201 })
      }),
    ),
    http.delete(`${API}/purchase-rfqs/:id`, ({ params }) => {
      const q = db.rfqs.find((x) => x.id === params.id)
      if (q && q.status !== 'draft') return locked()
      db.rfqs = db.rfqs.filter((x) => x.id !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.patch(`${API}/purchase-rfqs/:id`, async ({ request, params }) => {
      const q = db.rfqs.find((x) => x.id === params.id)
      if (!q) return error(404, 'NOT_FOUND', 'Bulunamadı.')
      const body = await json(request)
      if (q.status !== 'draft') return locked()
      if (stale(q, body)) return conflict()
      if (Array.isArray(body.supplier_ids))
        q.suppliers = (body.supplier_ids as string[]).map((sid) => ({
          party_id: sid,
          party_name: db.parties.find((x) => x.id === sid)?.name ?? '',
          status: 'invited',
          responded_at: null,
        }))
      q.response_due = body.response_due === undefined ? q.response_due : str(body.response_due)
      touch(q, 'updated')
      return HttpResponse.json({ data: bare(q) })
    }),
    http.post(`${API}/purchase-rfqs/:id/:action`, ({ request, params }) =>
      idempotent(request, `/purchase-rfqs/${String(params.action)}`, async () => {
        const q = db.rfqs.find((x) => x.id === params.id)
        if (!q) return error(404, 'NOT_FOUND', 'Bulunamadı.')
        const body = await json(request)
        if (stale(q, body)) return conflict()
        const action = String(params.action)
        if (action === 'send') {
          if (q.status !== 'draft') return illegal()
          if ((q.suppliers ?? []).length === 0)
            return invalid({ supplier_ids: ['En az bir tedarikçi gerekir.'] })
          q.status = 'sent'
          q.number = nextNumber('RFQ')
        } else if (action === 'cancel') {
          if (!['draft', 'sent', 'collecting'].includes(q.status)) return illegal()
          q.status = 'cancelled'
        } else if (action === 'quotes') {
          if (!['sent', 'collecting'].includes(q.status)) return illegal()
          const partyId = String(body.party_id)
          const supplier = q.suppliers?.find((s) => s.party_id === partyId)
          if (!supplier) return invalid({ party_id: ['Bu tedarikçi davet edilmedi.'] })
          q.quotes = (q.quotes ?? []).filter((x) => x.party_id !== partyId)
          if (body.declined !== true) {
            for (const row of (body.quotes as Body[] | undefined) ?? []) {
              q.quotes.push({
                id: `qt-${++db.seq}`,
                rfq_line_id: String(row.rfq_line_id),
                party_id: partyId,
                unit_price: qty6(dec(row.unit_price)),
                discount_percent: dec(row.discount_percent ?? '0').toFixed(4),
                net_unit_price: qty6(
                  dec(row.unit_price).mul(
                    new Decimal(1).minus(dec(row.discount_percent ?? '0').div(100)),
                  ),
                ),
                lead_time_days: typeof row.lead_time_days === 'number' ? row.lead_time_days : null,
                valid_until: str(row.valid_until),
                notes: str(row.notes),
              })
            }
          }
          supplier.status = body.declined === true ? 'declined' : 'responded'
          supplier.responded_at = now
          q.status = 'collecting'
        } else if (action === 'award') {
          if (!can('purchasing.rfqs.award') || !can('purchasing.orders.create')) return forbidden()
          if (!['sent', 'collecting'].includes(q.status)) return illegal()
          const picks: [string, string][] = Array.isArray(body.lines)
            ? (body.lines as Body[]).map((p) => [String(p.rfq_line_id), String(p.party_id)])
            : (q.quotes ?? [])
                .filter((x) => x.party_id === body.party_id)
                .map((x) => [x.rfq_line_id, x.party_id])
          if (picks.length === 0) return invalid({ party_id: ['Bu tedarikçinin teklifi yok.'] })
          const byParty = new Map<string, [string, RfqQuote][]>()
          for (const [lineId, partyId] of picks) {
            const quote = q.quotes?.find((x) => x.rfq_line_id === lineId && x.party_id === partyId)
            if (!quote)
              return invalid({ lines: ['Seçilen tedarikçinin bu satır için teklifi yok.'] })
            byParty.set(partyId, [...(byParty.get(partyId) ?? []), [lineId, quote]])
          }
          const created: WireOrder[] = []
          for (const [partyId, rows] of [...byParty.entries()].sort(([a], [b]) =>
            a.localeCompare(b),
          )) {
            const id = `o-new-${++db.seq}`
            const lines = rows.map(([lineId, quote], i) => {
              const l = q.lines?.find((x) => x.id === lineId)
              const line = q.lines?.find((x) => x.id === lineId)
              if (line) line.awarded_party_id = partyId
              return orderLine({ taxCodes: db.taxCodes }, id, i + 1, {
                item_id: l?.item_id ?? ITEM_BOLT,
                item_type: l?.item_type ?? 'stock',
                unit_id: l?.unit_id ?? UNIT_PCS,
                quantity: l?.quantity ?? '1',
                unit_price: quote.unit_price,
                discount_percent: quote.discount_percent,
                price_source: 'quote',
                rfq_line_id: lineId,
              })
            })
            const doc = order(
              {
                id,
                status: 'draft',
                rfq_id: q.id,
                party_id: partyId,
                party_name: db.parties.find((x) => x.id === partyId)?.name ?? '',
                currency_code: q.currency_code,
                ...totals(lines, new Decimal(1)),
              },
              lines,
            )
            db.orders.push(doc)
            created.push(doc)
          }
          q.status = 'awarded'
          touch(q, 'awarded')
          return HttpResponse.json(
            { data: { ...bare(q), orders: created.map(bare) } },
            { status: 201 },
          )
        } else return error(404, 'NOT_FOUND', 'Bulunamadı.')
        touch(q, action)
        return HttpResponse.json({ data: bare(q) })
      }),
    ),
    // ---- orders -----------------------------------------------------------------------------
    http.get(`${API}/purchase-orders/export`, () => csv('siparisler')),
    http.get(`${API}/purchase-orders`, ({ request }) =>
      HttpResponse.json(
        listOf(
          db.orders.map(bare) as unknown as WireOrder[],
          new URL(request.url),
          (o) => [o.party_id],
          (o) => (db.orders.find((x) => x.id === o.id)?.lines ?? []).map((l) => l.item_id),
        ),
      ),
    ),
    http.get(`${API}/purchase-orders/:id`, ({ params }) => {
      const o = db.orders.find((x) => x.id === params.id)
      return o
        ? HttpResponse.json({ data: detail.order(o) })
        : error(404, 'NOT_FOUND', 'Bulunamadı.')
    }),
    http.post(`${API}/purchase-orders`, ({ request }) =>
      idempotent(request, '/purchase-orders', async () => {
        const body = await json(request)
        const id = `o-new-${++db.seq}`
        const { fields, parts } = composeOrder(id, body)
        if (Object.keys(fields).length) return invalid(fields)
        const doc = order({ id, status: 'draft', ...parts }, parts.lines)
        db.orders.push(doc)
        return HttpResponse.json({ data: bare(doc) }, { status: 201 })
      }),
    ),
    http.patch(`${API}/purchase-orders/:id`, async ({ request, params }) => {
      const o = db.orders.find((x) => x.id === params.id)
      if (!o) return error(404, 'NOT_FOUND', 'Bulunamadı.')
      const body = await json(request)
      if (o.status !== 'draft') return locked()
      if (stale(o, body)) return conflict()
      const { fields, parts } = composeOrder(o.id, body, o)
      if (Object.keys(fields).length) return invalid(fields)
      Object.assign(o, parts)
      touch(o, 'updated')
      return HttpResponse.json({ data: bare(o) })
    }),
    http.delete(`${API}/purchase-orders/:id`, ({ params }) => {
      const o = db.orders.find((x) => x.id === params.id)
      if (o && o.status !== 'draft') return locked()
      db.orders = db.orders.filter((x) => x.id !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/purchase-orders/:id/:action`, ({ request, params }) =>
      idempotent(request, `/purchase-orders/${String(params.action)}`, async () => {
        const o = db.orders.find((x) => x.id === params.id)
        if (!o) return error(404, 'NOT_FOUND', 'Bulunamadı.')
        const body = await json(request)
        const action = String(params.action)
        if (action === 'receipts' || action === 'invoices') {
          const receiving = action === 'receipts'
          if (!can(receiving ? 'purchasing.receipts.create' : 'purchasing.invoices.create'))
            return forbidden()
          if (!OPEN.includes(o.status)) return invalid({ order: ['Sipariş açık değil.'] })
          const roi = body.receive_on_invoice === true
          const picks = (body.lines as Body[] | undefined) ?? []
          const fields: Record<string, string[]> = {}
          picks.forEach((p, i) => {
            const l = o.lines?.find((x) => x.id === p.order_line_id)
            if (!l) {
              fields[`lines.${i}.order_line_id`] = ['Kaynak satır bulunamadı.']
              return
            }
            const service = l.item_type === 'service'
            const bound = receiving
              ? dec(l.quantity)
                  .mul(new Decimal(100).plus(dec(db.overReceiptPercent)))
                  .div(100)
                  .minus(dec(l.received_quantity))
              : (service || roi
                  ? Decimal.max(dec(l.quantity), dec(l.received_quantity))
                  : dec(l.received_quantity)
                ).minus(dec(l.invoiced_quantity))
            if (receiving && service)
              fields[`lines.${i}.quantity`] = ['Hizmet satırı teslim alınmaz.']
            else if (dec(p.quantity).gt(bound))
              fields[`lines.${i}.quantity`] = [`En fazla ${bound.toString()} girilebilir.`]
          })
          if (Object.keys(fields).length) return invalid(fields)
          const id = `${receiving ? 'g' : 'i'}-new-${++db.seq}`
          const lines = picks.map((p) => ({
            order_line_id: String(p.order_line_id),
            quantity: String(p.quantity),
          }))
          if (receiving) db.receipts.push({ id, order_id: o.id, lines })
          else db.invoices.push({ id, order_id: o.id, receive_on_invoice: roi, lines })
          return HttpResponse.json(
            {
              data: {
                id,
                number: null,
                status: 'draft',
                document_type: receiving ? 'purchase_receipt' : 'purchase_invoice',
              },
            },
            { status: 201 },
          )
        }
        const needs =
          action === 'submit' || action === 'revise' || action === 'close'
            ? 'purchasing.orders.approve'
            : 'purchasing.orders.update'
        if (!can(needs)) return forbidden()
        if (stale(o, body)) return conflict()
        if (action === 'submit') {
          if (o.status !== 'draft') return illegal()
          submitOrder(o)
        } else if (action === 'send') {
          if (!['approved', 'sent', 'partially_received'].includes(o.status)) return illegal()
          o.sent_at ??= now
          if (o.status === 'approved') o.status = 'sent'
        } else if (action === 'cancel') {
          if (!['draft', 'pending_approval', 'approved', 'sent'].includes(o.status))
            return illegal()
          if (hasDocuments(o)) return invalid({ order: ['Siparişin mal kabul veya faturası var.'] })
          o.status = 'cancelled'
        } else if (action === 'close') {
          if (![...OPEN, 'invoiced'].includes(o.status)) return illegal()
          o.status = 'closed'
        } else if (action === 'revise') {
          if (!['approved', 'sent', 'pending_approval'].includes(o.status)) return illegal()
          if (hasDocuments(o)) return invalid({ order: ['Siparişin mal kabul veya faturası var.'] })
          const { fields, parts } = composeOrder(o.id, body, o)
          if (Object.keys(fields).length) return invalid(fields)
          Object.assign(o, parts)
          o.revision += 1
          submitOrder(o)
        } else return error(404, 'NOT_FOUND', 'Bulunamadı.')
        touch(o, action)
        return HttpResponse.json({ data: bare(o) })
      }),
    ),
  ]
}
