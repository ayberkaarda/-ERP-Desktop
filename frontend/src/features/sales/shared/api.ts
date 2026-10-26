import Decimal from 'decimal.js'
import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import type { AuditEntry } from '@/components/shared/AuditTrail'
import { ApiError, platform, withIdempotency } from '@/platform'
import { labelLines } from './lib/labels'
import type {
  ApiAuditRow,
  ApiSalesOrder,
  ApiSalesQuote,
  CreatedDocument,
  CustomerExposure,
  Envelope,
  FulfilmentInput,
  Paginated,
  PreviewTotals,
  PreviewTotalsInput,
  SalesDocumentInput,
  SalesDocumentLink,
  SalesDocumentType,
  SalesLine,
  SalesOrderSummary,
  SalesQuoteSummary,
  SalesWarning,
  TaxBreakdownRow,
  WireLinks,
  WireOrder,
  WirePreview,
  WireQuote,
  WireWarning,
} from './types'

const http = () => platform.http
const seg = (id: string) => encodeURIComponent(id)

export const QUOTES_PATH = '/sales-quotes'
export const ORDERS_PATH = '/sales-orders'

/** Audit rows name only the causer; AuditTrail wants its entry shape. */
export function toAudit(id: string, rows: ApiAuditRow[] | undefined): AuditEntry[] | undefined {
  return rows?.map((a, i) => ({
    id: `${id}-a${i}`,
    event: a.event,
    description: a.description ?? null,
    causer: a.causer_id ? { id: a.causer_id, name: a.causer_name ?? '' } : null,
    created_at: a.created_at ?? '',
    properties: a.properties ?? null,
  }))
}

export type SalesQuote = Omit<ApiSalesQuote, 'audit'> & { audit?: AuditEntry[] }
export type SalesOrder = Omit<ApiSalesOrder, 'audit'> & { audit?: AuditEntry[] }

const STAGES: SalesDocumentType[] = [
  'sales_quote',
  'sales_order',
  'sales_delivery',
  'sales_invoice',
  'sales_return',
  'sales_credit_note',
]

/** Relations between documents of one type: revisions and corrected invoices. */
const UPSTREAM = new Set(['previous_revision', 'original_invoice'])
const DOWNSTREAM = new Set(['next_revisions', 'credit_notes', 'credit_invoice'])

function directionOf(relation: string, link: SalesDocumentType, current: SalesDocumentType) {
  if (UPSTREAM.has(relation)) return 'upstream' as const
  if (DOWNSTREAM.has(relation)) return 'downstream' as const
  return STAGES.indexOf(link) < STAGES.indexOf(current)
    ? ('upstream' as const)
    : ('downstream' as const)
}

/** The API's links object as one list (each relation's documents, in the API's order). */
export function flattenLinks(
  links: WireLinks | undefined,
  current: SalesDocumentType,
): SalesDocumentLink[] {
  if (!links) return []
  const out: SalesDocumentLink[] = []
  for (const [relation, value] of Object.entries(links)) {
    const rows = value === null ? [] : Array.isArray(value) ? value : [value]
    for (const l of rows) {
      out.push({
        type: l.document_type,
        id: l.id,
        number: l.number,
        status: l.status,
        document_date: l.document_date,
        total: l.total,
        currency_code: l.currency_code,
        direction: directionOf(relation, l.document_type, current),
      })
    }
  }
  return out
}

/** Tax per code and rate from the lines (the detail carries no tax table). */
export function taxBreakdown(lines: readonly SalesLine[]): TaxBreakdownRow[] {
  const rows = new Map<string, { row: TaxBreakdownRow; base: Decimal; amount: Decimal }>()
  for (const l of lines) {
    const k = `${l.tax_code_id ?? 'none'}|${new Decimal(l.tax_rate || '0').toString()}`
    const entry = rows.get(k) ?? {
      row: { tax_code_id: l.tax_code_id, tax_code: null, rate: l.tax_rate, base: '0', amount: '0' },
      base: new Decimal(0),
      amount: new Decimal(0),
    }
    entry.base = entry.base.plus(l.net_amount || '0')
    entry.amount = entry.amount.plus(l.tax_amount || '0')
    rows.set(k, entry)
  }
  return [...rows.values()].map(({ row, base, amount }) => ({
    ...row,
    base: base.toFixed(4),
    amount: amount.toFixed(4),
  }))
}

const toWarning = (w: WireWarning): SalesWarning => ({
  code: w.code,
  message: w.message,
  details: w.details ?? null,
})

/** The parts every document shares: party snapshot, links list, warnings, audit, tax table. */
async function normalizeDocument<W extends WireQuote | WireOrder>(raw: W, signal?: AbortSignal) {
  const {
    party_name,
    party_tax_office,
    party_tax_number,
    billing_address,
    links,
    warnings,
    audit,
    lines = [],
    ...rest
  } = raw
  const sorted = [...lines].sort((a, b) => a.line_no - b.line_no)
  const labelled = await labelLines(sorted, signal)
  return {
    ...rest,
    party: {
      name: party_name,
      tax_office: party_tax_office,
      tax_number: party_tax_number,
      billing_address,
    },
    // fx_rate 1 = the document is in company currency; otherwise the screen falls back to it.
    local_currency_code: new Decimal(raw.fx_rate || '0').eq(1) ? raw.currency_code : null,
    links: flattenLinks(links, raw.document_type),
    warnings: (warnings ?? []).map(toWarning),
    audit: toAudit(raw.id, audit),
    tax_breakdown: taxBreakdown(labelled),
    lines: labelled,
  }
}

export const normalizeQuote = async (raw: WireQuote, signal?: AbortSignal): Promise<SalesQuote> =>
  await normalizeDocument(raw, signal)

export const normalizeOrder = async (raw: WireOrder, signal?: AbortSignal): Promise<SalesOrder> =>
  (await normalizeDocument(raw, signal)) as unknown as SalesOrder

/** A document returned by an action, with the warnings of meta (credit warn mode etc.). */
export interface ActionResult<T> {
  document: T
  warnings: SalesWarning[]
}

interface WarnMeta {
  warnings?: WireWarning[]
}

const quoteResult = async (
  r: Envelope<WireQuote, WarnMeta>,
): Promise<ActionResult<SalesQuote>> => ({
  document: await normalizeQuote(r.data),
  warnings: (r.meta?.warnings ?? []).map(toWarning),
})
const orderResult = async (
  r: Envelope<WireOrder, WarnMeta>,
): Promise<ActionResult<SalesOrder>> => ({
  document: await normalizeOrder(r.data),
  warnings: (r.meta?.warnings ?? []).map(toWarning),
})

export const quotesApi = {
  path: QUOTES_PATH,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<SalesQuoteSummary>>(QUOTES_PATH, { params: toListParams(query), signal }),
  get: async (id: string, signal?: AbortSignal) => {
    const r = await http().get<Envelope<WireQuote>>(`${QUOTES_PATH}/${seg(id)}`, { signal })
    return normalizeQuote(r.data, signal)
  },
  create: (input: SalesDocumentInput, key: string) =>
    http()
      .post<Envelope<WireQuote, WarnMeta>>(QUOTES_PATH, input, withIdempotency({}, key))
      .then(quoteResult),
  update: (id: string, input: SalesDocumentInput & { version: number }) =>
    http()
      .patch<Envelope<WireQuote, WarnMeta>>(`${QUOTES_PATH}/${seg(id)}`, input)
      .then(quoteResult),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${QUOTES_PATH}/${seg(id)}`, { params: { version } }),
  /** send | accept: state changes with the version only. */
  transition: (id: string, action: 'send' | 'accept', version: number, key: string) =>
    http()
      .post<Envelope<WireQuote, WarnMeta>>(
        `${QUOTES_PATH}/${seg(id)}/${action}`,
        { version },
        withIdempotency({}, key),
      )
      .then(quoteResult),
  reject: (id: string, version: number, reason: string, key: string) =>
    http()
      .post<Envelope<WireQuote, WarnMeta>>(
        `${QUOTES_PATH}/${seg(id)}/reject`,
        { version, reason },
        withIdempotency({}, key),
      )
      .then(quoteResult),
  /** A new draft revision linked by previous_revision_id; the revised quote is cancelled. */
  revise: (id: string, version: number, key: string) =>
    http()
      .post<Envelope<WireQuote, WarnMeta>>(
        `${QUOTES_PATH}/${seg(id)}/revise`,
        { version },
        withIdempotency({}, key),
      )
      .then(quoteResult),
  /** Creates the order (draft) and marks the quote converted. */
  convert: (id: string, version: number, key: string) =>
    http()
      .post<Envelope<WireOrder, WarnMeta>>(
        `${QUOTES_PATH}/${seg(id)}/convert`,
        { version },
        withIdempotency({}, key),
      )
      .then(orderResult),
}

export interface ConfirmInput {
  version: number
  /** Present only when a user with sales.credit_override confirms over the limit. */
  credit_override_reason?: string
}

export const ordersApi = {
  path: ORDERS_PATH,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<SalesOrderSummary>>(ORDERS_PATH, { params: toListParams(query), signal }),
  get: async (id: string, signal?: AbortSignal) => {
    const r = await http().get<Envelope<WireOrder>>(`${ORDERS_PATH}/${seg(id)}`, { signal })
    return normalizeOrder(r.data, signal)
  },
  create: (input: SalesDocumentInput, key: string) =>
    http()
      .post<Envelope<WireOrder, WarnMeta>>(ORDERS_PATH, input, withIdempotency({}, key))
      .then(orderResult),
  update: (id: string, input: SalesDocumentInput & { version: number }) =>
    http()
      .patch<Envelope<WireOrder, WarnMeta>>(`${ORDERS_PATH}/${seg(id)}`, input)
      .then(orderResult),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${ORDERS_PATH}/${seg(id)}`, { params: { version } }),
  /** Confirmed, or pending_approval above sales.require_approval_over. */
  confirm: (id: string, input: ConfirmInput, key: string) =>
    http()
      .post<Envelope<WireOrder, WarnMeta>>(
        `${ORDERS_PATH}/${seg(id)}/confirm`,
        input,
        withIdempotency({}, key),
      )
      .then(orderResult),
  /** Edits a confirmed order before any delivery (credit and reservations re-validated). */
  revise: (
    id: string,
    input: SalesDocumentInput & { version: number; credit_override_reason?: string },
    key: string,
  ) =>
    http()
      .post<Envelope<WireOrder, WarnMeta>>(
        `${ORDERS_PATH}/${seg(id)}/revise`,
        input,
        withIdempotency({}, key),
      )
      .then(orderResult),
  /** The API takes no reason on cancel; the version guards against a stale copy. */
  cancel: (id: string, version: number, key: string) =>
    http()
      .post<Envelope<WireOrder, WarnMeta>>(
        `${ORDERS_PATH}/${seg(id)}/cancel`,
        { version },
        withIdempotency({}, key),
      )
      .then(orderResult),
  /** Ends a confirmed / partly fulfilled order; open reservations are released. */
  close: (id: string, version: number, key: string) =>
    http()
      .post<Envelope<WireOrder, WarnMeta>>(
        `${ORDERS_PATH}/${seg(id)}/close`,
        { version },
        withIdempotency({}, key),
      )
      .then(orderResult),
  createDelivery: (id: string, input: FulfilmentInput, key: string) =>
    http()
      .post<Envelope<CreatedDocument>>(
        `${ORDERS_PATH}/${seg(id)}/deliveries`,
        input,
        withIdempotency({}, key),
      )
      .then((r) => r.data),
  createInvoice: (id: string, input: FulfilmentInput, key: string) =>
    http()
      .post<Envelope<CreatedDocument>>(
        `${ORDERS_PATH}/${seg(id)}/invoices`,
        input,
        withIdempotency({}, key),
      )
      .then((r) => r.data),
}

/** The API answer of preview-totals in the editor's terms (lines keyed like the request). */
export function toPreviewTotals(
  input: PreviewTotalsInput,
  data: WirePreview,
  warnings: WireWarning[] = [],
): PreviewTotals {
  const keyAt = (i: number | null | undefined) =>
    i === null || i === undefined ? null : (input.lines[i]?.key ?? null)
  return {
    lines: data.lines.map((l, i) => ({
      key: input.lines[i]?.key ?? String(i),
      unit_price: l.unit_price,
      price_source: l.price_source,
      resolved_price: l.pricing?.unit_price ?? null,
      base_quantity: l.base_quantity,
      net_amount: l.net_amount,
      tax_code_id: l.tax_code_id,
      tax_rate: l.tax_rate,
      tax_amount: l.tax_amount,
      line_total: l.line_total,
    })),
    subtotal: data.totals.subtotal,
    discount_total: data.totals.discount_total,
    tax_total: data.totals.tax_total,
    total: data.totals.total,
    total_local: data.totals.total_local,
    fx_rate: data.header.fx_rate,
    local_currency_code: new Decimal(data.header.fx_rate || '0').eq(1)
      ? data.header.currency_code
      : null,
    tax_breakdown: data.taxes.map((t) => ({
      tax_code_id: t.tax_code_id,
      tax_code: null,
      rate: t.rate,
      base: t.base,
      amount: t.tax,
    })),
    warnings: warnings.map((w) => ({ ...toWarning(w), line_key: keyAt(w.line) })),
  }
}

export const previewApi = {
  /** Server totals and price resolution for the editor; nothing is persisted. */
  totals: async (input: PreviewTotalsInput, signal?: AbortSignal): Promise<PreviewTotals> => {
    // document_type and the line keys are the editor's own; the API composes from the rest.
    const body = {
      party_id: input.party_id,
      document_date: input.document_date,
      currency_code: input.currency_code,
      fx_rate: input.fx_rate,
      price_list_id: input.price_list_id,
      warehouse_id: input.warehouse_id,
      lines: input.lines.map((l) => ({
        item_id: l.item_id,
        variant_id: l.variant_id,
        quantity: l.quantity,
        unit_id: l.unit_id,
        unit_price: l.unit_price,
        discount_percent: l.discount_percent,
        discount_amount: l.discount_amount,
        tax_code_id: l.tax_code_id,
        warehouse_id: l.warehouse_id,
      })),
    }
    const r = await http().post<Envelope<WirePreview, WarnMeta>>(
      '/sales-documents/preview-totals',
      body,
      { signal },
    )
    return toPreviewTotals(input, r.data, r.meta?.warnings ?? [])
  },
}

interface ItemUnitRow {
  unit_id: string
  factor: string
}

interface UnitRow {
  id: string
  code: string
  name: string
}

/** A unit a line may use: the base unit (factor 1) or an alternate with its factor. */
export interface UnitChoice {
  unit_id: string
  code: string
  name: string
  factor: string
}

export interface StockFigures {
  on_hand: string
  reserved: string
  available: string
}

export interface ItemStockSummary extends StockFigures {
  item_id: string
  warehouses: (StockFigures & { warehouse_id: string })[]
}

export const LIMIT_EXCEEDED = 'LIMIT_EXCEEDED'
/** Safety stop: 100 pages of 100 rows. */
export const MAX_LOOKUP_PAGES = 100

/**
 * Every page of a lookup list up to the reported last page. Never returns a partial list: past
 * MAX_LOOKUP_PAGES it fails with LIMIT_EXCEEDED instead of passing a capped result as complete.
 */
export async function fetchAll<T>(url: string, signal?: AbortSignal): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; ; page++) {
    const res = await http().get<Paginated<T>>(url, { params: { page, per_page: 100 }, signal })
    if (res.meta.pagination.last_page > MAX_LOOKUP_PAGES) {
      throw new ApiError(0, LIMIT_EXCEEDED, `More than ${MAX_LOOKUP_PAGES * 100} rows.`)
    }
    out.push(...res.data)
    if (page >= res.meta.pagination.last_page || res.data.length === 0) return out
  }
}

interface SettingRow {
  key: string
  value: unknown
  default: unknown
}

/** Lookups owned by other modules: Catalog units, Inventory stock, Workflow approvals. */
export const lookupsApi = {
  /** With a document id the answer also carries what that order / invoice adds (document_amount). */
  exposure: (partyId: string, signal?: AbortSignal, documentId?: string | null) =>
    http()
      .get<Envelope<CustomerExposure>>(`/customers/${seg(partyId)}/exposure`, {
        params: documentId ? { document_id: documentId } : undefined,
        signal,
      })
      .then((r) => r.data),
  /** sales.allow_over_delivery_percent (Settings needs settings.view); null when unset. */
  overDeliveryPercent: async (signal?: AbortSignal): Promise<string | null> => {
    const r = await http().get<Envelope<SettingRow[]>>('/settings', {
      params: { group: 'sales' },
      signal,
    })
    const row = r.data.find((s) => s.key === 'sales.allow_over_delivery_percent')
    const value = row?.value ?? row?.default
    return typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))
      ? String(value)
      : null
  },
  units: (signal?: AbortSignal) => fetchAll<UnitRow>('/units', signal),
  itemUnits: async (
    item: { id: string; base_unit_id: string },
    units: UnitRow[],
    signal?: AbortSignal,
  ): Promise<UnitChoice[]> => {
    const alternates = await fetchAll<ItemUnitRow>(`/items/${seg(item.id)}/units`, signal)
    const label = (id: string) => units.find((u) => u.id === id)
    const base = label(item.base_unit_id)
    return [
      {
        unit_id: item.base_unit_id,
        code: base?.code ?? '',
        name: base?.name ?? '',
        factor: '1',
      },
      ...alternates
        .filter((a) => a.unit_id !== item.base_unit_id)
        .map((a) => ({
          unit_id: a.unit_id,
          code: label(a.unit_id)?.code ?? '',
          name: label(a.unit_id)?.name ?? '',
          factor: a.factor,
        })),
    ]
  },
  /** GET /items/{id}/stock (inventory.stock.view): totals and per warehouse, base unit. */
  itemStock: (itemId: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<ItemStockSummary>>(`/items/${seg(itemId)}/stock`, { signal })
      .then((r) => r.data),
  approval: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<ApprovalRequest>>(`/approvals/${seg(id)}`, { signal })
      .then((r) => r.data),
}

/** Workflow ApprovalRequestResource (steps is the flow snapshot taken at start). */
export interface ApprovalRequest {
  id: string
  status: string
  current_step: number | null
  amount: string | null
  steps: { position: number; name?: string | null; min_amount?: string | null }[] | null
  decisions?: {
    id: string
    step_position: number
    actor_id: string
    actor_name?: string | null
    decision: 'approve' | 'reject'
    comment: string | null
    decided_at: string
  }[]
}
