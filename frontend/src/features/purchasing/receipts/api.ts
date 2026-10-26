import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { withIdempotency } from '@/platform'
import { http, seg } from '../invoices/kit/http'
import { labelSorted, normalizeHeader } from '../invoices/kit/normalize'
import type { Envelope, Paginated } from '../invoices/kit/types'
import type {
  CancelInput,
  OrderSource,
  RawOrder,
  RawReceipt,
  Receipt,
  ReceiptFromOrderInput,
  ReceiptInput,
  ReceiptSummary,
} from './types'

/** Detail as the screens use it: supplier snapshot, chain, labelled lines with serial arrays. */
export async function toReceipt(raw: RawReceipt, signal?: AbortSignal): Promise<Receipt> {
  const head = normalizeHeader(raw)
  const lines = await labelSorted(raw.lines, signal)
  return {
    ...head,
    lines: lines.map((l) => ({ ...l, serial_numbers: l.serial_numbers ?? [] })),
  }
}

const BASE = '/purchase-receipts'
type ReceiptEnvelope = Envelope<RawReceipt, { replayed?: boolean }>
const one = (r: ReceiptEnvelope, signal?: AbortSignal) => toReceipt(r.data, signal)

export const receiptsApi = {
  path: BASE,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<ReceiptSummary>>(BASE, { params: toListParams(query), signal }),
  get: (id: string, signal?: AbortSignal) =>
    http()
      .get<ReceiptEnvelope>(`${BASE}/${seg(id)}`, { signal })
      .then((r) => one(r, signal)),
  /** Direct receipt draft (only with purchasing.allow_direct_receipt). */
  create: (input: ReceiptInput, key: string) =>
    http()
      .post<ReceiptEnvelope>(BASE, input, withIdempotency({}, key))
      .then((r) => one(r)),
  /** Draft for order lines; bounded by the remaining quantity and the over-receipt tolerance. */
  createFromOrder: (orderId: string, input: ReceiptFromOrderInput, key: string) =>
    http()
      .post<ReceiptEnvelope>(
        `/purchase-orders/${seg(orderId)}/receipts`,
        input,
        withIdempotency({}, key),
      )
      .then((r) => one(r)),
  update: (id: string, input: ReceiptInput & { version: number }) =>
    http()
      .patch<ReceiptEnvelope>(`${BASE}/${seg(id)}`, input)
      .then((r) => one(r)),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${BASE}/${seg(id)}`, { params: { version } }),
  /** Numbers (GRN), posts stock at order cost and the GRNI accrual; idempotent by key and state. */
  post: (id: string, version: number, key: string) =>
    http()
      .post<ReceiptEnvelope>(`${BASE}/${seg(id)}/post`, { version }, withIdempotency({}, key))
      .then((r) => one(r)),
  cancel: (id: string, input: CancelInput, key: string) =>
    http()
      .post<ReceiptEnvelope>(`${BASE}/${seg(id)}/cancel`, input, withIdempotency({}, key))
      .then((r) => one(r)),
  /** Order fields for the editor (lines with ordered and received quantities, labelled). */
  order: async (id: string, signal?: AbortSignal): Promise<OrderSource> => {
    const raw = (await http().get<Envelope<RawOrder>>(`/purchase-orders/${seg(id)}`, { signal }))
      .data
    return {
      id: raw.id,
      number: raw.number,
      status: raw.status,
      party_id: raw.party_id,
      party_name: raw.party_name,
      warehouse_id: raw.warehouse_id,
      currency_code: raw.currency_code,
      lines: await labelSorted(raw.lines, signal),
    }
  },
}
