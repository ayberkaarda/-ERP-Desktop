import Decimal from 'decimal.js'
import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { taxBreakdown, toAudit } from '@/features/sales/shared/api'
import { labelLines } from '@/features/sales/shared/lib/labels'
import type { SalesLine } from '@/features/sales/shared'
import { platform, withIdempotency } from '@/platform'
import {
  PURCHASE_DOCUMENT_TYPES,
  type AwardInput,
  type CreatedDocument,
  type Envelope,
  type InvoiceFromOrderInput,
  type LineLabels,
  type OrderInput,
  type OrderSummary,
  type Paginated,
  type PreviewInput,
  type PreviewTotals,
  type PurchaseDocumentType,
  type PurchaseLink,
  type PurchaseOrder,
  type PurchaseRequest,
  type PurchaseRfq,
  type PurchaseWarning,
  type QuoteEntryInput,
  type ReceiptFromOrderInput,
  type RequestInput,
  type RequestSummary,
  type RequestToOrderInput,
  type RequestToRfqInput,
  type RfqComparison,
  type RfqInput,
  type RfqSummary,
  type SupplierExposure,
  type WireLinks,
  type WireOrder,
  type WirePreview,
  type WireRequest,
  type WireRfq,
  type WireWarning,
} from './types'

const http = () => platform.http
const seg = (id: string) => encodeURIComponent(id)

export const REQUESTS_PATH = '/purchase-requests'
export const RFQS_PATH = '/purchase-rfqs'
export const ORDERS_PATH = '/purchase-orders'

const isType = (t: string): t is PurchaseDocumentType =>
  (PURCHASE_DOCUMENT_TYPES as readonly string[]).includes(t)

/** The links object as one list; relations the viewer may not see come as null / [] and vanish. */
export function flattenLinks(links: WireLinks | undefined): PurchaseLink[] {
  if (!links) return []
  const out: PurchaseLink[] = []
  for (const value of Object.values(links)) {
    const rows = value === null ? [] : Array.isArray(value) ? value : [value]
    for (const l of rows) {
      if (!isType(l.document_type)) continue
      out.push({
        type: l.document_type,
        id: l.id,
        number: l.number,
        status: l.status,
        document_date: l.document_date ?? '',
        total: l.total,
        currency_code: l.currency_code,
      })
    }
  }
  return out
}

/**
 * Item code / name and unit codes from Catalog (the API sends ids only). The sales labeller
 * reads only item_id, unit_id and the label fields, so any line shape with those works.
 */
async function label<L extends { item_id: string; unit_id: string; line_no: number }>(
  lines: L[] | undefined,
  signal?: AbortSignal,
): Promise<(L & LineLabels)[]> {
  const sorted = [...(lines ?? [])].sort((a, b) => a.line_no - b.line_no)
  const labelled = await labelLines(sorted as unknown as SalesLine[], signal)
  return labelled as unknown as (L & LineLabels)[]
}

export async function normalizeRequest(
  raw: WireRequest,
  signal?: AbortSignal,
): Promise<PurchaseRequest> {
  const { lines, links, audit, ordered_quantities, ...rest } = raw
  const labelled = await label(lines, signal)
  return {
    ...rest,
    lines: labelled.map((l) => ({
      ...l,
      ordered: ordered_quantities?.[l.id] ?? l.ordered_quantity ?? '0',
    })),
    links: flattenLinks(links),
    audit: toAudit(raw.id, audit) ?? [],
  }
}

export async function normalizeRfq(raw: WireRfq, signal?: AbortSignal): Promise<PurchaseRfq> {
  const { lines, suppliers, quotes, links, audit, ...rest } = raw
  return {
    ...rest,
    lines: await label(lines, signal),
    suppliers: suppliers ?? [],
    quotes: quotes ?? [],
    links: flattenLinks(links),
    audit: toAudit(raw.id, audit) ?? [],
  }
}

export async function normalizeOrder(raw: WireOrder, signal?: AbortSignal): Promise<PurchaseOrder> {
  const { lines, links, audit, ...rest } = raw
  const labelled = await label(lines, signal)
  return {
    ...rest,
    lines: labelled,
    links: flattenLinks(links),
    audit: toAudit(raw.id, audit) ?? [],
    // Same fields as sales lines: tax_code_id, tax_rate, net_amount, tax_amount.
    tax_breakdown: taxBreakdown(labelled),
  }
}

export const toWarning = (w: WireWarning, keys?: readonly string[]): PurchaseWarning => ({
  code: w.code,
  message: w.message,
  line_key: w.line === null || w.line === undefined ? null : (keys?.[w.line] ?? null),
  line_no: w.line === null || w.line === undefined ? null : w.line + 1,
})

interface WarnMeta {
  warnings?: WireWarning[]
  replayed?: boolean
}

/** A document returned by a save or action, with the warnings of meta. */
export interface ActionResult<T> {
  document: T
  warnings: PurchaseWarning[]
}

const result =
  <W, T>(normalize: (raw: W) => Promise<T>) =>
  async (r: Envelope<W, WarnMeta>): Promise<ActionResult<T>> => ({
    document: await normalize(r.data),
    warnings: (r.meta?.warnings ?? []).map((w) => toWarning(w)),
  })

const requestResult = result<WireRequest, PurchaseRequest>((raw) => normalizeRequest(raw))
const rfqResult = result<WireRfq, PurchaseRfq>((raw) => normalizeRfq(raw))
const orderResult = result<WireOrder, PurchaseOrder>((raw) => normalizeOrder(raw))

const post = <W>(path: string, body: unknown, key: string) =>
  http().post<Envelope<W, WarnMeta>>(path, body, withIdempotency({}, key))

export const requestsApi = {
  path: REQUESTS_PATH,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<RequestSummary>>(REQUESTS_PATH, {
      params: toListParams(query),
      signal,
    }),
  get: async (id: string, signal?: AbortSignal) => {
    const r = await http().get<Envelope<WireRequest>>(`${REQUESTS_PATH}/${seg(id)}`, { signal })
    return normalizeRequest(r.data, signal)
  },
  create: (input: RequestInput, key: string) =>
    post<WireRequest>(REQUESTS_PATH, input, key).then(requestResult),
  /** A rejected request is reopened as a draft by the edit. */
  update: (id: string, input: RequestInput & { version: number }) =>
    http()
      .patch<Envelope<WireRequest, WarnMeta>>(`${REQUESTS_PATH}/${seg(id)}`, input)
      .then(requestResult),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${REQUESTS_PATH}/${seg(id)}`, { params: { version } }),
  /** Number PRQ; approval above purchasing.request_approval_over, else approved at once. */
  transition: (id: string, action: 'submit' | 'cancel', version: number, key: string) =>
    post<WireRequest>(`${REQUESTS_PATH}/${seg(id)}/${action}`, { version }, key).then(
      requestResult,
    ),
  toRfq: (id: string, input: RequestToRfqInput, key: string) =>
    post<WireRfq>(`${REQUESTS_PATH}/${seg(id)}/rfq`, input, key).then(rfqResult),
  toOrder: (id: string, input: RequestToOrderInput, key: string) =>
    post<WireOrder>(`${REQUESTS_PATH}/${seg(id)}/orders`, input, key).then(orderResult),
}

export const rfqsApi = {
  path: RFQS_PATH,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<RfqSummary>>(RFQS_PATH, { params: toListParams(query), signal }),
  get: async (id: string, signal?: AbortSignal) => {
    const r = await http().get<Envelope<WireRfq>>(`${RFQS_PATH}/${seg(id)}`, { signal })
    return normalizeRfq(r.data, signal)
  },
  create: (input: RfqInput, key: string) => post<WireRfq>(RFQS_PATH, input, key).then(rfqResult),
  update: (id: string, input: RfqInput & { version: number }) =>
    http()
      .patch<Envelope<WireRfq, WarnMeta>>(`${RFQS_PATH}/${seg(id)}`, input)
      .then(rfqResult),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${RFQS_PATH}/${seg(id)}`, { params: { version } }),
  /** send: number RFQ, needs lines and suppliers. */
  transition: (id: string, action: 'send' | 'cancel', version: number, key: string) =>
    post<WireRfq>(`${RFQS_PATH}/${seg(id)}/${action}`, { version }, key).then(rfqResult),
  /** Replaces one supplier's quotes (or records a decline); sent -> collecting. */
  quotes: (id: string, input: QuoteEntryInput, key: string) =>
    post<WireRfq>(`${RFQS_PATH}/${seg(id)}/quotes`, input, key).then(rfqResult),
  comparison: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<RfqComparison>>(`${RFQS_PATH}/${seg(id)}/comparison`, { signal })
      .then((r) => r.data),
  /** One draft order per awarded supplier; the RFQ becomes awarded. */
  award: async (id: string, input: AwardInput, key: string) => {
    const r = await post<WireRfq & { orders: WireOrder[] }>(
      `${RFQS_PATH}/${seg(id)}/award`,
      input,
      key,
    )
    const { orders, ...rfq } = r.data
    return {
      rfq: await normalizeRfq(rfq),
      orders: orders.map((o) => ({ id: o.id, number: o.number, party_name: o.party_name })),
    }
  },
}

export interface VersionInput {
  version: number
}

export const ordersApi = {
  path: ORDERS_PATH,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<OrderSummary>>(ORDERS_PATH, { params: toListParams(query), signal }),
  get: async (id: string, signal?: AbortSignal) => {
    const r = await http().get<Envelope<WireOrder>>(`${ORDERS_PATH}/${seg(id)}`, { signal })
    return normalizeOrder(r.data, signal)
  },
  create: (input: OrderInput, key: string) =>
    post<WireOrder>(ORDERS_PATH, input, key).then(orderResult),
  update: (id: string, input: OrderInput & VersionInput) =>
    http()
      .patch<Envelope<WireOrder, WarnMeta>>(`${ORDERS_PATH}/${seg(id)}`, input)
      .then(orderResult),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${ORDERS_PATH}/${seg(id)}`, { params: { version } }),
  /**
   * submit (number POR; approval above purchasing.require_approval_over), send (approved -> sent),
   * cancel (before any active receipt or invoice), close (ends an open order).
   */
  transition: (
    id: string,
    action: 'submit' | 'send' | 'cancel' | 'close',
    version: number,
    key: string,
  ) => post<WireOrder>(`${ORDERS_PATH}/${seg(id)}/${action}`, { version }, key).then(orderResult),
  /** Full payload + version; approved/sent/pending orders without receipts or invoices. */
  revise: (id: string, input: OrderInput & VersionInput, key: string) =>
    post<WireOrder>(`${ORDERS_PATH}/${seg(id)}/revise`, input, key).then(orderResult),
  createReceipt: (id: string, input: ReceiptFromOrderInput, key: string) =>
    post<CreatedDocument>(`${ORDERS_PATH}/${seg(id)}/receipts`, input, key).then((r) => r.data),
  createInvoice: (id: string, input: InvoiceFromOrderInput, key: string) =>
    post<CreatedDocument>(`${ORDERS_PATH}/${seg(id)}/invoices`, input, key).then((r) => r.data),
}

/** preview-totals answer keyed like the request lines. */
export function toPreviewTotals(
  input: PreviewInput,
  data: WirePreview,
  warnings: WireWarning[] = [],
): PreviewTotals {
  const keys = input.lines.map((l) => l.key)
  return {
    lines: data.lines.map((l, i) => ({
      key: keys[i] ?? String(i),
      unit_price: l.unit_price,
      price_source: l.price_source,
      base_quantity: l.base_quantity,
      net_amount: l.net_amount,
      tax_code_id: l.tax_code_id,
      tax_rate: l.tax_rate,
      tax_amount: l.tax_amount,
      withholding_amount: l.withholding_amount,
      line_total: l.line_total,
    })),
    subtotal: data.totals.subtotal,
    discount_total: data.totals.discount_total,
    tax_total: data.totals.tax_total,
    withholding_total: data.totals.withholding_total,
    total: data.totals.total,
    total_local: data.totals.total_local,
    fx_rate: data.header.fx_rate,
    tax_breakdown: data.taxes.map((t) => ({
      tax_code_id: t.tax_code_id,
      tax_code: null,
      rate: t.rate,
      base: t.base,
      amount: t.tax,
    })),
    warnings: warnings.map((w) => toWarning(w, keys)),
  }
}

export const previewApi = {
  /** Server totals incl. withholding (nothing stored, no Idempotency-Key). */
  totals: async (input: PreviewInput, signal?: AbortSignal): Promise<PreviewTotals> => {
    // The line keys are the editor's own.
    const body = {
      ...input,
      lines: input.lines.map((l) => ({
        item_id: l.item_id,
        variant_id: l.variant_id,
        unit_id: l.unit_id,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount_percent: l.discount_percent,
        discount_amount: l.discount_amount,
        tax_code_id: l.tax_code_id,
        withholding_code_id: l.withholding_code_id,
        tax_inclusive: l.tax_inclusive,
        warehouse_id: l.warehouse_id,
      })),
    }
    const r = await http().post<Envelope<WirePreview, WarnMeta>>(
      '/purchase-documents/preview-totals',
      body,
      { signal },
    )
    return toPreviewTotals(input, r.data, r.meta?.warnings ?? [])
  },
}

interface SettingRow {
  key: string
  value: unknown
  default: unknown
}

export const supplierApi = {
  exposure: (partyId: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<SupplierExposure>>(`/suppliers/${seg(partyId)}/exposure`, { signal })
      .then((r) => r.data),
  /** purchasing.allow_over_receipt_percent (Settings needs settings.view); null when unset. */
  overReceiptPercent: async (signal?: AbortSignal): Promise<string | null> => {
    const r = await http().get<Envelope<SettingRow[]>>('/settings', {
      params: { group: 'purchasing' },
      signal,
    })
    const row = r.data.find((s) => s.key === 'purchasing.allow_over_receipt_percent')
    const value = row?.value ?? row?.default
    const text = typeof value === 'number' ? String(value) : value
    return typeof text === 'string' && /^\d+(\.\d+)?$/.test(text)
      ? new Decimal(text).toString()
      : null
  },
}
