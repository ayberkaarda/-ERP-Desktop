import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import type { Item } from '@/features/catalog'
import type { Party } from '@/features/parties'
import type { Currency, PaymentTerm, TaxCode, Warehouse } from '@/features/reference'
import type {
  ApiAuditRow,
  ApiSalesOrder,
  ApiSalesQuote,
  CustomerExposure,
  PreviewTotalsInput,
  SalesDocumentLink,
  SalesLine,
  SalesLineInput,
  SalesOrderLine,
  SalesWarning,
  TaxBreakdownRow,
} from '../types'

// In-memory stand-in for the sales quote/order API as assumed in .orchestra/fe-sales1.md (PHASE5
// "HTTP API"), plus the lookups the screens read: parties, Catalog items/units, Reference tax
// codes / currencies / payment terms / warehouses, item stock, customer exposure, approvals and
// attachments. Errors use the envelope {errors: {message, code, fields?}}.

const API = '*/api/v1'

export const COMPANY_CURRENCY = 'TRY'
export const PARTY_ACME = 'party-acme'
export const PARTY_FREE = 'party-free'
export const ITEM_BOLT = 'item-bolt'
export const ITEM_SERVICE = 'item-service'
export const UNIT_PCS = 'unit-pcs'
export const UNIT_BOX = 'unit-box'
export const UNIT_HOUR = 'unit-hour'
export const TAX_20 = 'tax-kdv20'
export const TAX_10 = 'tax-kdv10'
export const WH_MAIN = 'wh-main'
export const QUOTE_DRAFT = 'q-draft'
export const QUOTE_SENT = 'q-sent'
export const ORDER_DRAFT = 'o-draft'
export const ORDER_CONFIRMED = 'o-confirmed'
export const APPROVAL_ID = 'apr-1'
export const USER_ID = '0192a000-0000-7000-8000-0000000000u1'

export interface SalesCall {
  method: string
  path: string
  body: unknown
  url: URL
  headers: Headers
}

export interface SalesDb {
  permissions: string[]
  parties: Party[]
  items: Item[]
  units: { id: string; code: string; name: string }[]
  itemUnits: { item_id: string; unit_id: string; factor: string }[]
  taxCodes: TaxCode[]
  currencies: Currency[]
  paymentTerms: PaymentTerm[]
  warehouses: Warehouse[]
  /** Base-unit price per item (the price list the resolver reads). */
  prices: Record<string, string>
  /** Available base quantity per item and warehouse. */
  stock: Record<string, Record<string, string>>
  /** Open invoice balance per party (company currency). */
  openInvoices: Record<string, string>
  quotes: ApiSalesQuote[]
  orders: ApiSalesOrder[]
  creditMode: 'off' | 'warn' | 'block'
  /** sales.require_approval_over; null = never. */
  approvalOver: string | null
  overDeliveryPercent: string
  calls: SalesCall[]
  /** Idempotency-Key -> stored response body and status (replayed on reuse). */
  idempotency: Map<string, { status: number; body: unknown }>
  /** Paths whose next POST fails with a network error (to test retries). */
  dropNext: string[]
  seq: number
}

const now = '2026-10-21T08:00:00Z'

const party = (over: Partial<Party> & Pick<Party, 'id' | 'code' | 'name'>): Party => ({
  legal_name: null,
  type: 'company',
  roles: ['customer'],
  tax_office: 'Kadıköy',
  tax_number: '1234567890',
  country: 'TR',
  default_currency_code: 'TRY',
  payment_term_id: null,
  price_list_id: 'pl-default',
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

const tax = (id: string, code: string, rate: string): TaxCode => ({
  id,
  company_id: null,
  type: 'vat',
  code,
  name: `KDV %${rate}`,
  rate,
  numerator: null,
  denominator: null,
  effective_from: '2020-01-01',
  effective_to: null,
  is_active: true,
  version: 1,
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

function line(docId: string, no: number, over: Partial<SalesOrderLine>): SalesOrderLine {
  return {
    id: `${docId}-l${no}`,
    line_no: no,
    item_id: ITEM_BOLT,
    item_code: 'CVT-01',
    item_name: 'Cıvata M8',
    item_type: 'stock',
    variant_id: null,
    description: null,
    quantity: '10.000000',
    unit_id: UNIT_PCS,
    unit_code: 'ADET',
    base_quantity: '10.000000',
    base_unit_id: UNIT_PCS,
    base_unit_code: 'ADET',
    unit_price: '10.0000',
    price_source: 'price_list',
    discount_percent: '0.0000',
    discount_amount: '0.0000',
    net_amount: '100.0000',
    tax_code_id: TAX_20,
    tax_code: 'KDV20',
    tax_rate: '20.000000',
    tax_amount: '20.0000',
    line_total: '120.0000',
    warehouse_id: null,
    source_line_id: null,
    delivered_quantity: '0.000000',
    invoiced_quantity: '0.000000',
    reservation_id: null,
    ...over,
  }
}

const header = {
  party_id: PARTY_ACME,
  party: { name: 'Acme Makina A.Ş.', tax_office: 'Kadıköy', tax_number: '1234567890' },
  currency_code: 'TRY',
  local_currency_code: COMPANY_CURRENCY,
  fx_rate: '1.000000',
  payment_term_id: null,
  due_date: null,
  price_list_id: 'pl-default',
  warehouse_id: WH_MAIN,
  cost_center_id: null,
  project_id: null,
  notes: null,
  internal_notes: null,
  source_type: null,
  source_id: null,
  subtotal: '100.0000',
  discount_total: '0.0000',
  tax_total: '20.0000',
  total: '120.0000',
  total_local: '120.0000',
  tax_breakdown: [
    {
      tax_code_id: TAX_20,
      tax_code: 'KDV20',
      rate: '20.000000',
      base: '100.0000',
      amount: '20.0000',
    },
  ],
  warnings: [],
  links: [],
  version: 1,
  created_by: USER_ID,
  created_at: now,
  updated_at: now,
}

const audit = (event: string): ApiAuditRow => ({
  event,
  description: event,
  causer_id: USER_ID,
  causer_name: 'Deniz Kaya',
  created_at: now,
})

export function createSalesDb(overrides: Partial<SalesDb> = {}): SalesDb {
  const quoteLine = (id: string) => toQuoteLine(line(id, 1, {}))
  return {
    permissions: [],
    parties: [
      party({
        id: PARTY_ACME,
        code: 'C0001',
        name: 'Acme Makina A.Ş.',
        risk_limit: '1000.0000',
        risk_currency_code: 'TRY',
      }),
      party({
        id: PARTY_FREE,
        code: 'C0002',
        name: 'Serbest Ticaret Ltd.',
        tax_number: '9876543210',
      }),
    ],
    items: [
      item({
        id: ITEM_BOLT,
        code: 'CVT-01',
        name: 'Cıvata M8',
        base_unit: { id: UNIT_PCS, code: 'ADET', name: 'Adet', symbol: null },
      }),
      item({
        id: ITEM_SERVICE,
        code: 'MNT-01',
        name: 'Montaj hizmeti',
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
    taxCodes: [tax(TAX_20, 'KDV20', '20.000000'), tax(TAX_10, 'KDV10', '10.000000')],
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
    prices: { [ITEM_BOLT]: '10.0000', [ITEM_SERVICE]: '250.0000' },
    stock: { [ITEM_BOLT]: { [WH_MAIN]: '30.000000' } },
    openInvoices: { [PARTY_ACME]: '500.0000' },
    quotes: [
      {
        ...header,
        id: QUOTE_DRAFT,
        number: 'TKL2026000001',
        status: 'draft',
        document_date: '2026-10-20',
        valid_until: '2026-11-19',
        revision: 0,
        previous_revision_id: null,
        lines: [quoteLine(QUOTE_DRAFT)],
        audit: [audit('created')],
      },
      {
        ...header,
        id: QUOTE_SENT,
        number: 'TKL2026000002',
        status: 'sent',
        document_date: '2026-10-18',
        valid_until: '2026-11-17',
        revision: 0,
        previous_revision_id: null,
        lines: [quoteLine(QUOTE_SENT)],
        audit: [audit('created'), audit('sent')],
      },
    ],
    orders: [
      {
        ...header,
        id: ORDER_DRAFT,
        number: 'SIP2026000001',
        status: 'draft',
        document_date: '2026-10-20',
        requested_delivery_date: null,
        approval_request_id: null,
        lines: [line(ORDER_DRAFT, 1, {})],
        audit: [audit('created')],
      },
      {
        ...header,
        id: ORDER_CONFIRMED,
        number: 'SIP2026000002',
        status: 'partially_delivered',
        document_date: '2026-10-15',
        requested_delivery_date: '2026-10-30',
        approval_request_id: null,
        subtotal: '600.0000',
        tax_total: '120.0000',
        total: '720.0000',
        total_local: '720.0000',
        lines: [
          line(ORDER_CONFIRMED, 1, {
            delivered_quantity: '4.000000',
            invoiced_quantity: '1.000000',
          }),
          line(ORDER_CONFIRMED, 2, {
            item_id: ITEM_SERVICE,
            item_code: 'MNT-01',
            item_name: 'Montaj hizmeti',
            item_type: 'service',
            quantity: '2.000000',
            base_quantity: '2.000000',
            unit_id: UNIT_HOUR,
            unit_code: 'SAAT',
            unit_price: '250.0000',
            net_amount: '500.0000',
            tax_amount: '100.0000',
            line_total: '600.0000',
          }),
        ],
        links: [
          {
            type: 'sales_quote',
            id: 'q-old',
            number: 'TKL2026000000',
            status: 'converted',
            document_date: '2026-10-10',
            direction: 'upstream',
          },
          {
            type: 'sales_delivery',
            id: 'd-1',
            number: 'IRS2026000001',
            status: 'posted',
            document_date: '2026-10-16',
            direction: 'downstream',
          },
        ],
        audit: [audit('created'), audit('confirmed')],
      },
    ],
    creditMode: 'block',
    approvalOver: null,
    overDeliveryPercent: '0',
    calls: [],
    idempotency: new Map(),
    dropNext: [],
    seq: 0,
    ...overrides,
  }
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)

/** A quote line is an order line without the fulfilment columns. */
function toQuoteLine(l: SalesOrderLine): SalesLine {
  const out: Partial<SalesOrderLine> = { ...l }
  delete out.delivered_quantity
  delete out.invoiced_quantity
  delete out.reservation_id
  return out as SalesLine
}

function error(status: number, code: string, message: string, fields?: Record<string, string[]>) {
  return HttpResponse.json({ errors: { message, code, ...(fields ? { fields } : {}) } }, { status })
}

const dec = (v: unknown) =>
  typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? new Decimal(v) : new Decimal(0)
const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(4)
const qty6 = (d: Decimal) => d.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6)

function paginate<T>(rows: T[], url: URL) {
  const perPage = Math.min(100, Number(url.searchParams.get('per_page') ?? 25) || 25)
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1)
  const total = rows.length
  return {
    data: rows.slice((page - 1) * perPage, page * perPage),
    meta: {
      pagination: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    },
  }
}

interface PricedLine {
  key: string
  input: SalesLineInput
  unit_price: string
  price_source: string | null
  base_quantity: string
  net_amount: string
  tax_code_id: string | null
  tax_code: string | null
  tax_rate: string
  tax_amount: string
  line_total: string
}

function toPreviewLine(p: PricedLine) {
  return {
    key: p.key,
    unit_price: p.unit_price,
    price_source: p.price_source,
    base_quantity: p.base_quantity,
    net_amount: p.net_amount,
    tax_code_id: p.tax_code_id,
    tax_rate: p.tax_rate,
    tax_amount: p.tax_amount,
    line_total: p.line_total,
  }
}

export function salesHandlers(db: SalesDb) {
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
  const itemOf = (id: string) => db.items.find((i) => i.id === id)
  const unitOf = (id: string) => db.units.find((u) => u.id === id)
  const factorOf = (itemId: string, unitId: string) => {
    const it = itemOf(itemId)
    if (it?.base_unit_id === unitId) return new Decimal(1)
    const alt = db.itemUnits.find((u) => u.item_id === itemId && u.unit_id === unitId)
    return alt ? new Decimal(alt.factor) : null
  }

  /** Server-side pricing and totals of request lines (the resolver fills missing prices). */
  function price(lines: (SalesLineInput & { key?: string })[]) {
    const warnings: SalesWarning[] = []
    const fields: Record<string, string[]> = {}
    const priced: PricedLine[] = lines.map((l, i) => {
      const it = itemOf(l.item_id)
      const factor = factorOf(l.item_id, l.unit_id)
      if (!it) fields[`lines.${i}.item_id`] = ['Stok kartı bulunamadı.']
      if (!factor) fields[`lines.${i}.unit_id`] = ['Birim bu stok kartında tanımlı değil.']
      if (!dec(l.quantity).gt(0)) fields[`lines.${i}.quantity`] = ['Miktar sıfırdan büyük olmalı.']
      const f = factor ?? new Decimal(1)
      let unitPrice: Decimal
      let source: string | null
      if (l.unit_price !== null) {
        unitPrice = dec(l.unit_price)
        source = 'manual'
      } else if (db.prices[l.item_id]) {
        unitPrice = dec(db.prices[l.item_id]).mul(f)
        source = 'price_list'
      } else {
        unitPrice = new Decimal(0)
        source = null
        warnings.push({
          code: 'sales.price_not_found',
          message: 'Fiyat bulunamadı.',
          line_key: l.key ?? null,
          line_no: i + 1,
        })
      }
      const q = dec(l.quantity)
      const gross = q.mul(unitPrice)
      const net = gross
        .mul(new Decimal(1).minus(dec(l.discount_percent).div(100)))
        .minus(dec(l.discount_amount))
      const taxCode = db.taxCodes.find((c) => c.id === (l.tax_code_id ?? it?.default_tax_code_id))
      const rate = dec(taxCode?.rate ?? '0')
      const netR = net.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      const taxAmount = netR.mul(rate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      return {
        key: l.key ?? String(i),
        input: l,
        unit_price: unitPrice.toFixed(4),
        price_source: source,
        base_quantity: qty6(q.mul(f)),
        net_amount: money(netR),
        tax_code_id: taxCode?.id ?? null,
        tax_code: taxCode?.code ?? null,
        tax_rate: qty6(rate),
        tax_amount: money(taxAmount),
        line_total: money(netR.plus(taxAmount)),
      }
    })
    const sum = (pick: (p: PricedLine) => Decimal) =>
      priced.reduce((acc, p) => acc.plus(pick(p)), new Decimal(0))
    const subtotal = sum((p) =>
      dec(p.input.quantity).mul(dec(p.unit_price)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    )
    const net = sum((p) => dec(p.net_amount))
    const taxTotal = sum((p) => dec(p.tax_amount))
    const breakdown = new Map<string, TaxBreakdownRow>()
    for (const p of priced) {
      const k = p.tax_code_id ?? 'none'
      const row = breakdown.get(k) ?? {
        tax_code_id: p.tax_code_id,
        tax_code: p.tax_code,
        rate: p.tax_rate,
        base: '0.0000',
        amount: '0.0000',
      }
      row.base = money(dec(row.base).plus(dec(p.net_amount)))
      row.amount = money(dec(row.amount).plus(dec(p.tax_amount)))
      breakdown.set(k, row)
    }
    const total = net.plus(taxTotal)
    return {
      priced,
      fields,
      warnings,
      totals: {
        subtotal: money(subtotal),
        discount_total: money(subtotal.minus(net)),
        tax_total: money(taxTotal),
        total: money(total),
        tax_breakdown: [...breakdown.values()],
      },
    }
  }

  function linesOf(docId: string, priced: PricedLine[]): SalesOrderLine[] {
    return priced.map((p, i) => {
      const it = itemOf(p.input.item_id)
      const unit = unitOf(p.input.unit_id)
      const base = it ? unitOf(it.base_unit_id) : undefined
      return {
        id: p.input.id ?? `${docId}-n${++db.seq}`,
        line_no: i + 1,
        item_id: p.input.item_id,
        item_code: it?.code ?? null,
        item_name: it?.name ?? null,
        item_type: it?.type ?? null,
        variant_id: null,
        description: p.input.description,
        quantity: qty6(dec(p.input.quantity)),
        unit_id: p.input.unit_id,
        unit_code: unit?.code ?? null,
        base_quantity: p.base_quantity,
        base_unit_id: it?.base_unit_id ?? null,
        base_unit_code: base?.code ?? null,
        unit_price: p.unit_price,
        price_source: p.price_source,
        discount_percent: dec(p.input.discount_percent).toFixed(4),
        discount_amount: dec(p.input.discount_amount).toFixed(4),
        net_amount: p.net_amount,
        tax_code_id: p.tax_code_id,
        tax_code: p.tax_code,
        tax_rate: p.tax_rate,
        tax_amount: p.tax_amount,
        line_total: p.line_total,
        warehouse_id: null,
        source_line_id: null,
        delivered_quantity: '0.000000',
        invoiced_quantity: '0.000000',
        reservation_id: null,
      }
    })
  }

  type Body = Record<string, unknown>

  /** Header + lines of a create/PATCH/revise body; returns field errors or the document parts. */
  function build(docId: string, body: Body) {
    const fields: Record<string, string[]> = {}
    const p = db.parties.find((x) => x.id === body.party_id)
    if (!p) fields.party_id = ['Müşteri seçin.']
    else if (!p.roles.includes('customer') || !p.is_active)
      fields.party_id = ['Cari etkin bir müşteri değil.']
    const lines = Array.isArray(body.lines) ? (body.lines as SalesLineInput[]) : []
    if (lines.length === 0) fields.lines = ['En az bir satır girin.']
    if (lines.length > 500) fields.lines = ['En çok 500 satır olabilir.']
    lines.forEach((l, i) => {
      if (l.unit_price !== null && !can('sales.price_override'))
        fields[`lines.${i}.unit_price`] = ['Fiyatı değiştirme yetkiniz yok.']
    })
    const result = price(lines)
    Object.assign(fields, result.fields)
    const fx = body.fx_rate
      ? dec(body.fx_rate)
      : body.currency_code === COMPANY_CURRENCY
        ? new Decimal(1)
        : new Decimal('35.5')
    return {
      fields,
      parts: {
        party_id: str(body.party_id),
        party: {
          name: p?.name ?? '',
          tax_office: p?.tax_office ?? null,
          tax_number: p?.tax_number ?? null,
        },
        document_date: str(body.document_date),
        currency_code: str(body.currency_code, 'TRY'),
        fx_rate: qty6(fx),
        payment_term_id: (body.payment_term_id as string | null) ?? null,
        price_list_id: (body.price_list_id as string | null) ?? null,
        warehouse_id: (body.warehouse_id as string | null) ?? null,
        notes: (body.notes as string | null) ?? null,
        internal_notes: (body.internal_notes as string | null) ?? null,
        ...result.totals,
        total_local: money(dec(result.totals.total).mul(fx)),
        warnings: result.warnings.map((w) => ({ ...w, line_key: null })),
      },
      lines: linesOf(docId, result.priced),
    }
  }

  /** Replays a stored response for a reused Idempotency-Key; drops a request when asked. */
  async function idempotent(
    request: Request,
    path: string,
    run: () => Promise<Response> | Response,
  ): Promise<Response> {
    const key = request.headers.get('Idempotency-Key')
    const drop = db.dropNext.indexOf(path)
    if (key && db.idempotency.has(key)) {
      const stored = db.idempotency.get(key)
      return HttpResponse.json(stored?.body as Record<string, unknown>, { status: stored?.status })
    }
    const res = await run()
    if (key && res.status < 500) {
      const body: unknown = await res
        .clone()
        .json()
        .catch(() => null)
      db.idempotency.set(key, { status: res.status, body })
    }
    if (drop >= 0) {
      // The server did the work, the client never saw the answer.
      db.dropNext.splice(drop, 1)
      return HttpResponse.error()
    }
    return res
  }

  const exposureOf = (partyId: string): CustomerExposure => {
    const p = db.parties.find((x) => x.id === partyId)
    const orders = db.orders
      .filter(
        (o) =>
          o.party_id === partyId &&
          ['confirmed', 'partially_delivered', 'delivered', 'partially_invoiced'].includes(
            o.status,
          ),
      )
      .reduce((acc, o) => acc.plus(dec(o.total_local)), new Decimal(0))
    const invoices = dec(db.openInvoices[partyId] ?? '0')
    const total = orders.plus(invoices)
    const limit = p?.risk_limit ?? null
    return {
      party_id: partyId,
      limit,
      currency: p?.risk_currency_code ?? COMPANY_CURRENCY,
      open_invoices: money(invoices),
      open_orders: money(orders),
      total: money(total),
      available: limit ? money(dec(limit).minus(total)) : null,
    }
  }

  /** Credit check at confirm / revise: null = allowed; else the 422 response. */
  function credit(
    order: ApiSalesOrder,
    reason: unknown,
    warnings: SalesWarning[],
    counted: boolean,
  ) {
    const e = exposureOf(order.party_id)
    if (db.creditMode === 'off' || e.limit === null) return null
    const exposure = counted ? dec(e.total).minus(dec(order.total_local)) : dec(e.total)
    if (exposure.plus(dec(order.total_local)).lte(dec(e.limit))) return null
    if (db.creditMode === 'warn') {
      warnings.push({
        code: 'sales.credit_limit_warning',
        message: 'Müşterinin kredi limiti aşılıyor.',
      })
      return null
    }
    if (typeof reason === 'string' && reason.trim() !== '') {
      if (!can('sales.credit_override')) return error(403, 'FORBIDDEN', 'Limit aşımı yetkiniz yok.')
      return null
    }
    return error(422, 'sales.credit_limit_exceeded', 'Müşterinin kredi limiti aşılıyor.', {
      limit: [e.limit],
      exposure: [money(exposure)],
      document: [order.total_local],
      currency: [e.currency],
    })
  }

  const listOf = <
    T extends {
      status: string
      document_date: string
      party_id: string
      number: string | null
      lines: { item_id: string }[]
    },
  >(
    rows: T[],
    url: URL,
  ) => {
    const s = url.searchParams
    const q = (s.get('q') ?? '').toLocaleLowerCase('tr')
    let out = rows.filter((r) => {
      if (s.get('filter[status]') && r.status !== s.get('filter[status]')) return false
      if (s.get('filter[party_id]') && r.party_id !== s.get('filter[party_id]')) return false
      if (s.get('filter[date_from]') && r.document_date < (s.get('filter[date_from]') ?? ''))
        return false
      if (s.get('filter[date_to]') && r.document_date > (s.get('filter[date_to]') ?? ''))
        return false
      if (s.get('filter[number]') && !(r.number ?? '').includes(s.get('filter[number]') ?? ''))
        return false
      if (s.get('filter[item_id]') && !r.lines.some((l) => l.item_id === s.get('filter[item_id]')))
        return false
      return q === '' || (r.number ?? '').toLocaleLowerCase('tr').includes(q)
    })
    const sort = s.get('sort') ?? '-document_date'
    const desc = sort.startsWith('-')
    const key = sort.replace(/^-/, '') as keyof T
    out = [...out].sort(
      (a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (desc ? -1 : 1),
    )
    return paginate(out, url)
  }

  const quoteSummary = (q: ApiSalesQuote) => ({
    id: q.id,
    number: q.number,
    status: q.status,
    document_date: q.document_date,
    valid_until: q.valid_until,
    party_id: q.party_id,
    party_name: q.party.name,
    currency_code: q.currency_code,
    total: q.total,
    total_local: q.total_local,
    revision: q.revision,
    version: q.version,
    lines: q.lines,
  })
  const orderSummary = (o: ApiSalesOrder) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    document_date: o.document_date,
    requested_delivery_date: o.requested_delivery_date,
    party_id: o.party_id,
    party_name: o.party.name,
    currency_code: o.currency_code,
    total: o.total,
    total_local: o.total_local,
    version: o.version,
    lines: o.lines,
  })

  const stripQuoteLines = (lines: SalesOrderLine[]): SalesLine[] => lines.map(toQuoteLine)

  const nextNumber = (prefix: string, rows: { number: string | null }[]) =>
    `${prefix}2026${String(rows.length + 1).padStart(6, '0')}`

  const findQuote = (id: string | readonly string[] | undefined) =>
    db.quotes.find((q) => q.id === id)
  const findOrder = (id: string | readonly string[] | undefined) =>
    db.orders.find((o) => o.id === id)
  const versionMismatch = (doc: { version: number }, body: Body) =>
    typeof body.version === 'number' && body.version !== doc.version
  const conflict = () => error(409, 'VERSION_CONFLICT', 'Belge başka biri tarafından değiştirildi.')
  const illegal = () => error(409, 'INVALID_TRANSITION', 'Bu işlem belgenin durumunda yapılamaz.')
  const json = async (request: Request) => ((await request.json().catch(() => ({}))) ?? {}) as Body
  const touch = (doc: { version: number; audit?: ApiAuditRow[] }, event: string) => {
    doc.version += 1
    doc.audit = [...(doc.audit ?? []), audit(event)]
  }
  const downloadCsv = (name: string) =>
    new HttpResponse('number;total\n', {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${name}.csv"`,
      },
    })

  return [
    record,
    // ---- lookups -------------------------------------------------------------------------
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
    http.get(`${API}/items/:id`, ({ params }) => {
      const it = itemOf(String(params.id))
      return it ? HttpResponse.json({ data: it }) : error(404, 'NOT_FOUND', 'Bulunamadı.')
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
    http.get(`${API}/items/:id/stock`, ({ params }) => {
      if (!can('inventory.stock.view')) return error(403, 'FORBIDDEN', 'Yetkiniz yok.')
      const per = db.stock[String(params.id)] ?? {}
      const total = Object.values(per).reduce((a, v) => a.plus(dec(v)), new Decimal(0))
      return HttpResponse.json({
        data: {
          item_id: params.id,
          on_hand: qty6(total),
          reserved: '0.000000',
          available: qty6(total),
          warehouses: Object.entries(per).map(([warehouse_id, v]) => ({
            warehouse_id,
            on_hand: v,
            reserved: '0.000000',
            available: v,
          })),
        },
      })
    }),
    http.get(`${API}/units`, ({ request }) =>
      HttpResponse.json(paginate(db.units, new URL(request.url))),
    ),
    http.get(`${API}/tax-codes`, ({ request }) =>
      HttpResponse.json(paginate(db.taxCodes, new URL(request.url))),
    ),
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
          amount: '120.0000',
          steps: [{ position: 1, name: 'Satış müdürü' }],
          decisions: [],
        },
      }),
    ),
    http.get(`${API}/customers/:id/exposure`, ({ params }) =>
      HttpResponse.json({ data: exposureOf(String(params.id)) }),
    ),
    // ---- preview ------------------------------------------------------------------------
    http.post(`${API}/sales-documents/preview-totals`, async ({ request }) => {
      const body = (await request.json()) as PreviewTotalsInput
      const lines = body.lines.map((l) => ({ ...l, description: null, warehouse_id: null }))
      const result = price(lines)
      const fx = body.fx_rate
        ? dec(body.fx_rate)
        : body.currency_code === COMPANY_CURRENCY
          ? new Decimal(1)
          : new Decimal('35.5')
      return HttpResponse.json({
        data: {
          lines: result.priced.map(toPreviewLine),
          ...result.totals,
          total_local: money(dec(result.totals.total).mul(fx)),
          fx_rate: qty6(fx),
          local_currency_code: COMPANY_CURRENCY,
          warnings: result.warnings,
        },
      })
    }),
    // ---- quotes -------------------------------------------------------------------------
    http.get(`${API}/sales-quotes/export`, () => downloadCsv('teklifler')),
    http.get(`${API}/sales-quotes`, ({ request }) =>
      HttpResponse.json(listOf(db.quotes.map(quoteSummary), new URL(request.url))),
    ),
    http.post(`${API}/sales-quotes`, ({ request }) =>
      idempotent(request, '/sales-quotes', async () => {
        if (!can('sales.quotes.create')) return error(403, 'FORBIDDEN', 'Yetkiniz yok.')
        const body = await json(request)
        const id = `q-new-${++db.seq}`
        const built = build(id, body)
        if (Object.keys(built.fields).length > 0)
          return error(422, 'VALIDATION_FAILED', 'Belge doğrulanamadı.', built.fields)
        const quote: ApiSalesQuote = {
          ...header,
          ...built.parts,
          id,
          number: nextNumber('TKL', db.quotes),
          status: 'draft',
          valid_until: (body.valid_until as string | null) ?? null,
          revision: 0,
          previous_revision_id: null,
          links: [],
          version: 1,
          lines: stripQuoteLines(built.lines),
          audit: [audit('created')],
        }
        db.quotes.push(quote)
        return HttpResponse.json({ data: quote, meta: { warnings: [] } }, { status: 201 })
      }),
    ),
    http.get(`${API}/sales-quotes/:id`, ({ params }) => {
      const q = findQuote(params.id)
      return q ? HttpResponse.json({ data: q }) : error(404, 'NOT_FOUND', 'Teklif bulunamadı.')
    }),
    http.patch(`${API}/sales-quotes/:id`, async ({ request, params }) => {
      const q = findQuote(params.id)
      if (!q) return error(404, 'NOT_FOUND', 'Teklif bulunamadı.')
      const body = await json(request)
      if (versionMismatch(q, body)) return conflict()
      if (q.status !== 'draft') return illegal()
      const built = build(q.id, body)
      if (Object.keys(built.fields).length > 0)
        return error(422, 'VALIDATION_FAILED', 'Belge doğrulanamadı.', built.fields)
      Object.assign(q, built.parts, {
        valid_until: (body.valid_until as string | null) ?? null,
        lines: stripQuoteLines(built.lines),
      })
      touch(q, 'updated')
      return HttpResponse.json({ data: q, meta: { warnings: [] } })
    }),
    http.delete(`${API}/sales-quotes/:id`, ({ params }) => {
      const i = db.quotes.findIndex((q) => q.id === params.id)
      if (i < 0) return error(404, 'NOT_FOUND', 'Teklif bulunamadı.')
      db.quotes.splice(i, 1)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/sales-quotes/:id/:action`, async ({ request, params }) => {
      const action = String(params.action)
      return idempotent(request, `/sales-quotes/${action}`, async () => {
        const q = findQuote(params.id)
        if (!q) return error(404, 'NOT_FOUND', 'Teklif bulunamadı.')
        const body = await json(request)
        if (versionMismatch(q, body)) return conflict()
        const allowed: Record<string, string[]> = {
          send: ['draft'],
          accept: ['sent'],
          reject: ['sent'],
          convert: ['sent', 'accepted'],
          revise: ['sent', 'rejected', 'expired'],
        }
        if (!allowed[action]?.includes(q.status)) return illegal()
        if (action === 'reject' && !(typeof body.reason === 'string' && body.reason.trim()))
          return error(422, 'VALIDATION_FAILED', 'Gerekçe zorunlu.', {
            reason: ['Gerekçe zorunlu.'],
          })
        if (action === 'revise') {
          const id = `q-rev-${++db.seq}`
          const copy: ApiSalesQuote = {
            ...structuredClone(q),
            id,
            status: 'draft',
            revision: q.revision + 1,
            previous_revision_id: q.id,
            version: 1,
            audit: [audit('created')],
          }
          db.quotes.push(copy)
          return HttpResponse.json({ data: copy, meta: { warnings: [] } }, { status: 201 })
        }
        if (action === 'convert') {
          const id = `o-new-${++db.seq}`
          const order: ApiSalesOrder = {
            ...structuredClone(q),
            id,
            number: nextNumber('SIP', db.orders),
            status: 'draft',
            requested_delivery_date: null,
            approval_request_id: null,
            source_type: 'sales_quote',
            source_id: q.id,
            version: 1,
            lines: q.lines.map((l) => ({
              ...l,
              id: `${id}-${l.id}`,
              source_line_id: l.id,
              delivered_quantity: '0.000000',
              invoiced_quantity: '0.000000',
              reservation_id: null,
            })),
            links: [
              {
                type: 'sales_quote',
                id: q.id,
                number: q.number,
                status: 'converted',
                document_date: q.document_date,
                direction: 'upstream',
              },
            ],
            audit: [audit('created')],
          }
          db.orders.push(order)
          q.status = 'converted'
          q.links = [
            {
              type: 'sales_order',
              id,
              number: order.number,
              status: 'draft',
              document_date: order.document_date,
              direction: 'downstream',
            },
          ]
          touch(q, 'converted')
          return HttpResponse.json({ data: order, meta: { warnings: [] } }, { status: 201 })
        }
        q.status = action === 'send' ? 'sent' : action === 'accept' ? 'accepted' : 'rejected'
        touch(q, action)
        return HttpResponse.json({ data: q, meta: { warnings: [] } })
      })
    }),
    // ---- orders -------------------------------------------------------------------------
    http.get(`${API}/sales-orders/export`, () => downloadCsv('siparisler')),
    http.get(`${API}/sales-orders`, ({ request }) =>
      HttpResponse.json(
        listOf(
          db.orders.map((o) => ({ ...orderSummary(o) })),
          new URL(request.url),
        ),
      ),
    ),
    http.post(`${API}/sales-orders`, ({ request }) =>
      idempotent(request, '/sales-orders', async () => {
        if (!can('sales.orders.create')) return error(403, 'FORBIDDEN', 'Yetkiniz yok.')
        const body = await json(request)
        const id = `o-new-${++db.seq}`
        const built = build(id, body)
        if (Object.keys(built.fields).length > 0)
          return error(422, 'VALIDATION_FAILED', 'Belge doğrulanamadı.', built.fields)
        const order: ApiSalesOrder = {
          ...header,
          ...built.parts,
          id,
          number: nextNumber('SIP', db.orders),
          status: 'draft',
          requested_delivery_date: (body.requested_delivery_date as string | null) ?? null,
          approval_request_id: null,
          links: [],
          version: 1,
          lines: built.lines,
          audit: [audit('created')],
        }
        db.orders.push(order)
        return HttpResponse.json({ data: order, meta: { warnings: [] } }, { status: 201 })
      }),
    ),
    http.get(`${API}/sales-orders/:id`, ({ params }) => {
      const o = findOrder(params.id)
      return o ? HttpResponse.json({ data: o }) : error(404, 'NOT_FOUND', 'Sipariş bulunamadı.')
    }),
    http.patch(`${API}/sales-orders/:id`, async ({ request, params }) => {
      const o = findOrder(params.id)
      if (!o) return error(404, 'NOT_FOUND', 'Sipariş bulunamadı.')
      const body = await json(request)
      if (versionMismatch(o, body)) return conflict()
      if (o.status !== 'draft') return illegal()
      const built = build(o.id, body)
      if (Object.keys(built.fields).length > 0)
        return error(422, 'VALIDATION_FAILED', 'Belge doğrulanamadı.', built.fields)
      Object.assign(o, built.parts, {
        requested_delivery_date: (body.requested_delivery_date as string | null) ?? null,
        lines: built.lines,
      })
      touch(o, 'updated')
      return HttpResponse.json({ data: o, meta: { warnings: [] } })
    }),
    http.delete(`${API}/sales-orders/:id`, ({ params }) => {
      const i = db.orders.findIndex((o) => o.id === params.id)
      if (i < 0) return error(404, 'NOT_FOUND', 'Sipariş bulunamadı.')
      db.orders.splice(i, 1)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/sales-orders/:id/:action`, async ({ request, params }) => {
      const action = String(params.action)
      return idempotent(request, `/sales-orders/${action}`, async () => {
        const o = findOrder(params.id)
        if (!o) return error(404, 'NOT_FOUND', 'Sipariş bulunamadı.')
        const body = await json(request)
        if (versionMismatch(o, body)) return conflict()
        const warnings: SalesWarning[] = []
        if (action === 'confirm') {
          if (o.status !== 'draft') return illegal()
          const blocked = credit(o, body.credit_override_reason, warnings, false)
          if (blocked) return blocked
          if (typeof body.credit_override_reason === 'string')
            o.credit_override_reason = body.credit_override_reason
          if (db.approvalOver !== null && dec(o.total_local).gte(dec(db.approvalOver))) {
            o.status = 'pending_approval'
            o.approval_request_id = APPROVAL_ID
          } else {
            o.status = 'confirmed'
          }
          touch(o, 'confirmed')
          return HttpResponse.json({ data: o, meta: { warnings } })
        }
        if (action === 'revise') {
          if (o.status !== 'confirmed' || o.lines.some((l) => dec(l.delivered_quantity).gt(0)))
            return illegal()
          const built = build(o.id, body)
          if (Object.keys(built.fields).length > 0)
            return error(422, 'VALIDATION_FAILED', 'Belge doğrulanamadı.', built.fields)
          const next = { ...o, ...built.parts, lines: built.lines }
          const blocked = credit(next, body.credit_override_reason, warnings, true)
          if (blocked) return blocked
          Object.assign(o, built.parts, { lines: built.lines })
          touch(o, 'revised')
          return HttpResponse.json({ data: o, meta: { warnings } })
        }
        if (action === 'cancel') {
          if (!(typeof body.reason === 'string' && body.reason.trim()))
            return error(422, 'VALIDATION_FAILED', 'Gerekçe zorunlu.', {
              reason: ['Gerekçe zorunlu.'],
            })
          o.status = 'cancelled'
          touch(o, 'cancelled')
          return HttpResponse.json({ data: o, meta: { warnings } })
        }
        if (action === 'deliveries' || action === 'invoices') {
          const lines = Array.isArray(body.lines)
            ? (body.lines as { order_line_id: string; quantity: string }[])
            : []
          const fields: Record<string, string[]> = {}
          lines.forEach((l, i) => {
            const ol = o.lines.find((x) => x.id === l.order_line_id)
            if (!ol) {
              fields[`lines.${i}.order_line_id`] = ['Sipariş satırı bulunamadı.']
              return
            }
            const ordered = dec(ol.quantity)
            const bound =
              action === 'deliveries'
                ? ordered
                    .mul(new Decimal(1).plus(dec(db.overDeliveryPercent).div(100)))
                    .minus(dec(ol.delivered_quantity))
                : (ol.item_type === 'service' || body.deliver_on_invoice === true
                    ? ordered
                    : dec(ol.delivered_quantity)
                  ).minus(dec(ol.invoiced_quantity))
            if (dec(l.quantity).gt(bound))
              fields[`lines.${i}.quantity`] = [`Kalan miktar ${bound.toString()}.`]
          })
          if (lines.length === 0) fields.lines = ['En az bir satır.']
          if (Object.keys(fields).length > 0)
            return error(422, 'VALIDATION_FAILED', 'Miktarlar kalanı aşıyor.', fields)
          const delivery = action === 'deliveries'
          const id = `${delivery ? 'd' : 'i'}-new-${++db.seq}`
          const link: SalesDocumentLink = {
            type: delivery ? 'sales_delivery' : 'sales_invoice',
            id,
            number: null,
            status: 'draft',
            document_date: str(body.document_date),
            direction: 'downstream',
          }
          o.links = [...(o.links ?? []), link]
          return HttpResponse.json({ data: { id, number: null, status: 'draft' } }, { status: 201 })
        }
        return illegal()
      })
    }),
  ]
}
