import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import type { AuditEntry } from '@/components/shared/AuditTrail'
import { ApiError, platform, withIdempotency } from '@/platform'
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
  SalesOrderSummary,
  SalesQuoteSummary,
  SalesWarning,
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

function normalize<T extends { id: string; lines: { line_no: number }[]; audit?: ApiAuditRow[] }>(
  raw: T,
): Omit<T, 'audit'> & { audit?: AuditEntry[] } {
  const { audit, ...rest } = raw
  return {
    ...rest,
    lines: [...raw.lines].sort((a, b) => a.line_no - b.line_no),
    audit: toAudit(raw.id, audit),
  }
}

/** A document returned by an action, with the warnings of meta (credit warn mode etc.). */
export interface ActionResult<T> {
  document: T
  warnings: SalesWarning[]
}

interface WarnMeta {
  warnings?: SalesWarning[]
}

const quoteResult = (r: Envelope<ApiSalesQuote, WarnMeta>): ActionResult<SalesQuote> => ({
  document: normalize<ApiSalesQuote>(r.data),
  warnings: r.meta?.warnings ?? [],
})
const orderResult = (r: Envelope<ApiSalesOrder, WarnMeta>): ActionResult<SalesOrder> => ({
  document: normalize<ApiSalesOrder>(r.data),
  warnings: r.meta?.warnings ?? [],
})

export const quotesApi = {
  path: QUOTES_PATH,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<SalesQuoteSummary>>(QUOTES_PATH, { params: toListParams(query), signal }),
  get: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<ApiSalesQuote>>(`${QUOTES_PATH}/${seg(id)}`, { signal })
      .then((r) => quoteResult(r).document),
  create: (input: SalesDocumentInput, key: string) =>
    http()
      .post<Envelope<ApiSalesQuote, WarnMeta>>(QUOTES_PATH, input, withIdempotency({}, key))
      .then(quoteResult),
  update: (id: string, input: SalesDocumentInput & { version: number }) =>
    http()
      .patch<Envelope<ApiSalesQuote, WarnMeta>>(`${QUOTES_PATH}/${seg(id)}`, input)
      .then(quoteResult),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${QUOTES_PATH}/${seg(id)}`, { params: { version } }),
  /** send | accept: state changes with the version only. */
  transition: (id: string, action: 'send' | 'accept', version: number, key: string) =>
    http()
      .post<Envelope<ApiSalesQuote, WarnMeta>>(
        `${QUOTES_PATH}/${seg(id)}/${action}`,
        { version },
        withIdempotency({}, key),
      )
      .then(quoteResult),
  reject: (id: string, version: number, reason: string, key: string) =>
    http()
      .post<Envelope<ApiSalesQuote, WarnMeta>>(
        `${QUOTES_PATH}/${seg(id)}/reject`,
        { version, reason },
        withIdempotency({}, key),
      )
      .then(quoteResult),
  /** A new draft revision linked by previous_revision_id; the old one stays as it is. */
  revise: (id: string, version: number, key: string) =>
    http()
      .post<Envelope<ApiSalesQuote, WarnMeta>>(
        `${QUOTES_PATH}/${seg(id)}/revise`,
        { version },
        withIdempotency({}, key),
      )
      .then(quoteResult),
  /** Creates the order (draft) and marks the quote converted. */
  convert: (id: string, version: number, key: string) =>
    http()
      .post<Envelope<ApiSalesOrder, WarnMeta>>(
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
  get: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<ApiSalesOrder>>(`${ORDERS_PATH}/${seg(id)}`, { signal })
      .then((r) => orderResult(r).document),
  create: (input: SalesDocumentInput, key: string) =>
    http()
      .post<Envelope<ApiSalesOrder, WarnMeta>>(ORDERS_PATH, input, withIdempotency({}, key))
      .then(orderResult),
  update: (id: string, input: SalesDocumentInput & { version: number }) =>
    http()
      .patch<Envelope<ApiSalesOrder, WarnMeta>>(`${ORDERS_PATH}/${seg(id)}`, input)
      .then(orderResult),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${ORDERS_PATH}/${seg(id)}`, { params: { version } }),
  /** Confirmed, or pending_approval above sales.require_approval_over. */
  confirm: (id: string, input: ConfirmInput, key: string) =>
    http()
      .post<Envelope<ApiSalesOrder, WarnMeta>>(
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
      .post<Envelope<ApiSalesOrder, WarnMeta>>(
        `${ORDERS_PATH}/${seg(id)}/revise`,
        input,
        withIdempotency({}, key),
      )
      .then(orderResult),
  cancel: (id: string, version: number, reason: string, key: string) =>
    http()
      .post<Envelope<ApiSalesOrder, WarnMeta>>(
        `${ORDERS_PATH}/${seg(id)}/cancel`,
        { version, reason },
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

export const previewApi = {
  /** Server totals and price resolution for the editor; nothing is persisted. */
  totals: (input: PreviewTotalsInput, signal?: AbortSignal) =>
    http()
      .post<Envelope<PreviewTotals>>('/sales-documents/preview-totals', input, { signal })
      .then((r) => r.data),
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

/** Lookups owned by other modules: Catalog units, Inventory stock, Workflow approvals. */
export const lookupsApi = {
  exposure: (partyId: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<CustomerExposure>>(`/customers/${seg(partyId)}/exposure`, { signal })
      .then((r) => r.data),
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
