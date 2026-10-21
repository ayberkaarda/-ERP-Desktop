import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { withIdempotency } from '@/platform'
import { fetchAll, http, seg, toAudit } from '../invoices/kit/http'
import type { Envelope, Paginated } from '../invoices/kit/types'
import type {
  ApiDelivery,
  CancelInput,
  DeliveryFromOrderInput,
  DeliveryInput,
  DeliverySummary,
  LotStock,
  OrderSource,
} from './types'
import type { AuditEntry } from '@/components/shared/AuditTrail'

export type Delivery = Omit<ApiDelivery, 'audit'> & { audit?: AuditEntry[] }

export function toDelivery(raw: ApiDelivery): Delivery {
  const { audit, ...rest } = raw
  return {
    ...rest,
    lines: [...raw.lines].sort((a, b) => a.line_no - b.line_no),
    audit: toAudit(raw.id, audit),
  }
}

const BASE = '/sales-deliveries'
const one = (r: Envelope<ApiDelivery>) => toDelivery(r.data)

export const deliveriesApi = {
  path: BASE,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<DeliverySummary>>(BASE, { params: toListParams(query), signal }),
  get: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<ApiDelivery>>(`${BASE}/${seg(id)}`, { signal })
      .then(one),
  /** Direct delivery draft (allowed only with sales.allow_direct_delivery). */
  create: (input: DeliveryInput, key: string) =>
    http().post<Envelope<ApiDelivery>>(BASE, input, withIdempotency({}, key)).then(one),
  /** Draft for order lines; bounded by the remaining quantity and the over-delivery tolerance. */
  createFromOrder: (orderId: string, input: DeliveryFromOrderInput, key: string) =>
    http()
      .post<Envelope<ApiDelivery>>(
        `/sales-orders/${seg(orderId)}/deliveries`,
        input,
        withIdempotency({}, key),
      )
      .then(one),
  update: (id: string, input: DeliveryInput & { version: number }) =>
    http()
      .patch<Envelope<ApiDelivery>>(`${BASE}/${seg(id)}`, input)
      .then(one),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${BASE}/${seg(id)}`, { params: { version } }),
  /** Issues the stock (StockService, COGS journal); idempotent by key and by state. */
  post: (id: string, version: number, key: string) =>
    http()
      .post<Envelope<ApiDelivery>>(`${BASE}/${seg(id)}/post`, { version }, withIdempotency({}, key))
      .then(one),
  cancel: (id: string, input: CancelInput, key: string) =>
    http()
      .post<Envelope<ApiDelivery>>(`${BASE}/${seg(id)}/cancel`, input, withIdempotency({}, key))
      .then(one),
  /** Order fields for the editor (lines with ordered and delivered quantities). */
  order: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<OrderSource>>(`/sales-orders/${seg(id)}`, { signal })
      .then((r) => r.data),
  /** Lots of an item with stock in a warehouse, for lot entry and the FEFO suggestion. */
  lots: (itemId: string, warehouseId: string, signal?: AbortSignal) =>
    fetchAll<LotStock>(
      '/stock-lots',
      {
        'filter[item_id]': itemId,
        'filter[warehouse_id]': warehouseId,
        'filter[with_stock]': '1',
        sort: 'expiry_date',
      },
      signal,
    ),
}
