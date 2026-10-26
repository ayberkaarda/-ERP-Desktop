import Decimal from 'decimal.js'
import type { AuditEntry } from '@/components/shared/AuditTrail'
import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { withIdempotency } from '@/platform'
import { fetchAll, http, seg } from '../invoices/kit/http'
import { labelLines, linkNamed, linksNamed, normalizeHeader } from '../invoices/kit/normalize'
import type { Envelope, Paginated } from '../invoices/kit/types'
import type {
  CancelInput,
  DeliveryDetail,
  DeliveryFromOrderInput,
  DeliveryInput,
  DeliverySummary,
  InvoicedState,
  LotStock,
  OrderSource,
  RawDelivery,
  RawOrder,
} from './types'

export type Delivery = Omit<DeliveryDetail, 'audit'> & { audit?: AuditEntry[] }

/** Invoice statuses whose lines hold delivered quantity (drafts included, as on the server). */
const HOLDING = new Set(['draft', 'pending_approval', 'issued', 'partially_paid', 'paid'])
/** More linked invoices than this are not read to compute the invoicing state. */
const MAX_INVOICE_READS = 20

interface InvoiceLinesOnly {
  lines: { delivery_line_id: string | null; quantity: string }[]
}

/** Quantity per delivery line on the active invoices linked to the delivery, or null if unknown. */
async function invoicedPerLine(
  raw: RawDelivery,
  signal?: AbortSignal,
): Promise<Map<string, Decimal> | null> {
  const active = linksNamed(raw.links, 'invoices').filter((l) => HOLDING.has(l.status))
  const out = new Map<string, Decimal>()
  if (active.length === 0) return out
  if (active.length > MAX_INVOICE_READS) return null
  try {
    const invoices = await Promise.all(
      active.map((l) =>
        http()
          .get<Envelope<InvoiceLinesOnly>>(`/sales-invoices/${seg(l.id)}`, { signal })
          .then((r) => r.data),
      ),
    )
    for (const line of invoices.flatMap((i) => i.lines)) {
      if (!line.delivery_line_id) continue
      out.set(
        line.delivery_line_id,
        (out.get(line.delivery_line_id) ?? new Decimal(0)).plus(line.quantity),
      )
    }
    return out
  } catch {
    return null
  }
}

/** Detail as the screens use it: snapshot, chain list, labelled lines, invoicing state. */
export async function toDelivery(raw: RawDelivery, signal?: AbortSignal): Promise<Delivery> {
  const head = normalizeHeader(raw)
  const sorted = [...raw.lines].sort((a, b) => a.line_no - b.line_no)
  const [labelled, invoiced] = await Promise.all([
    labelLines(sorted, signal),
    raw.status === 'posted' ? invoicedPerLine(raw, signal) : Promise.resolve(null),
  ])
  let state: InvoicedState | undefined
  if (invoiced) {
    const parts = sorted.map((l) => {
      const q = invoiced.get(l.id) ?? new Decimal(0)
      return q.isZero() ? 'none' : q.greaterThanOrEqualTo(l.quantity) ? 'full' : 'partial'
    })
    state = parts.every((p) => p === 'full')
      ? 'full'
      : parts.every((p) => p === 'none')
        ? 'none'
        : 'partial'
  }
  return {
    ...head,
    order_number: linkNamed(raw.links, 'order')?.number ?? null,
    invoiced_state: state,
    lines: labelled.map((l) => ({
      ...l,
      serial_numbers: l.serial_numbers ?? [],
      ...(invoiced ? { invoiced_quantity: (invoiced.get(l.id) ?? new Decimal(0)).toString() } : {}),
    })),
  }
}

const BASE = '/sales-deliveries'
const one = (r: Envelope<RawDelivery>, signal?: AbortSignal) => toDelivery(r.data, signal)

/** Lots of an item with stock in a warehouse: detail balances summed per lot, FEFO order. */
export async function lotsIn(
  itemId: string,
  warehouseId: string,
  signal?: AbortSignal,
): Promise<LotStock[]> {
  const rows = await fetchAll<{
    lot_id: string | null
    lot_no: string | null
    expiry_date: string | null
    on_hand: string
    available?: string | null
  }>(
    '/stock-balances',
    { group_by: 'detail', 'filter[item_id]': itemId, 'filter[warehouse_id]': warehouseId },
    signal,
  )
  const lots = new Map<string, LotStock>()
  for (const r of rows) {
    if (!r.lot_id || !r.lot_no) continue
    const prev = lots.get(r.lot_id)
    const onHand = new Decimal(prev?.on_hand ?? 0).plus(r.on_hand)
    const available = new Decimal(prev?.available ?? 0).plus(r.available ?? r.on_hand)
    lots.set(r.lot_id, {
      id: r.lot_id,
      lot_no: r.lot_no,
      expiry_date: r.expiry_date,
      on_hand: onHand.toString(),
      available: available.toString(),
    })
  }
  return [...lots.values()]
    .filter((l) => new Decimal(l.on_hand).greaterThan(0))
    .sort((a, b) =>
      a.expiry_date === b.expiry_date
        ? a.lot_no.localeCompare(b.lot_no)
        : a.expiry_date === null
          ? 1
          : b.expiry_date === null
            ? -1
            : a.expiry_date.localeCompare(b.expiry_date),
    )
}

export const deliveriesApi = {
  path: BASE,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<DeliverySummary>>(BASE, { params: toListParams(query), signal }),
  get: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<RawDelivery>>(`${BASE}/${seg(id)}`, { signal })
      .then((r) => one(r, signal)),
  /** Direct delivery draft (allowed only with sales.allow_direct_delivery). */
  create: (input: DeliveryInput, key: string) =>
    http()
      .post<Envelope<RawDelivery>>(BASE, input, withIdempotency({}, key))
      .then((r) => one(r)),
  /** Draft for order lines; bounded by the remaining quantity and the over-delivery tolerance. */
  createFromOrder: (orderId: string, input: DeliveryFromOrderInput, key: string) =>
    http()
      .post<Envelope<RawDelivery>>(
        `/sales-orders/${seg(orderId)}/deliveries`,
        input,
        withIdempotency({}, key),
      )
      .then((r) => one(r)),
  update: (id: string, input: DeliveryInput & { version: number }) =>
    http()
      .patch<Envelope<RawDelivery>>(`${BASE}/${seg(id)}`, input)
      .then((r) => one(r)),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${BASE}/${seg(id)}`, { params: { version } }),
  /** Issues the stock (StockService, COGS journal); idempotent by key and by state. */
  post: (id: string, version: number, key: string) =>
    http()
      .post<Envelope<RawDelivery>>(`${BASE}/${seg(id)}/post`, { version }, withIdempotency({}, key))
      .then((r) => one(r)),
  cancel: (id: string, input: CancelInput, key: string) =>
    http()
      .post<Envelope<RawDelivery>>(`${BASE}/${seg(id)}/cancel`, input, withIdempotency({}, key))
      .then((r) => one(r)),
  /** Order fields for the editor (lines with ordered and delivered quantities, labelled). */
  order: async (id: string, signal?: AbortSignal): Promise<OrderSource> => {
    const raw = (await http().get<Envelope<RawOrder>>(`/sales-orders/${seg(id)}`, { signal })).data
    return {
      id: raw.id,
      number: raw.number,
      status: raw.status,
      party_id: raw.party_id,
      party_name: raw.party_name,
      warehouse_id: raw.warehouse_id,
      currency_code: raw.currency_code,
      lines: await labelLines(raw.lines, signal),
    }
  },
  /** Lots of an item with stock in a warehouse, for lot entry and the FEFO suggestion. */
  lots: lotsIn,
}
