import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { dec } from '@/features/sales/invoices/kit/money'
import { withIdempotency } from '@/platform'
import { http, seg } from '../invoices/kit/http'
import { labelSorted, linksNamed, normalizeHeader } from '../invoices/kit/normalize'
import type { ApiLinks, Envelope, Paginated } from '../invoices/kit/types'
import type {
  PurchaseReturn,
  RawReturn,
  ReturnAction,
  ReturnCreateInput,
  ReturnSummary,
} from './types'

export async function toReturn(raw: RawReturn, signal?: AbortSignal): Promise<PurchaseReturn> {
  const head = normalizeHeader(raw)
  const lines = await labelSorted(raw.lines, signal)
  return { ...head, lines: lines.map((l) => ({ ...l, serial_numbers: l.serial_numbers ?? [] })) }
}

const BASE = '/purchase-returns'
type ReturnEnvelope = Envelope<RawReturn, { replayed?: boolean }>
const one = (r: ReturnEnvelope, signal?: AbortSignal) => toReturn(r.data, signal)

/** More linked returns than this are not read to compute what is still returnable. */
const MAX_RETURN_READS = 20

/**
 * Quantity per source line (invoice_line_id or receipt_line_id) on the non-cancelled returns
 * linked to a document, or null when there are too many to read. The server bounds anyway.
 */
export async function returnedPerLine(
  links: ApiLinks,
  key: 'invoice_line_id' | 'receipt_line_id',
  signal?: AbortSignal,
): Promise<Map<string, string> | null> {
  const active = linksNamed(links, 'returns').filter((l) => l.status !== 'cancelled')
  const out = new Map<string, string>()
  if (active.length === 0) return out
  if (active.length > MAX_RETURN_READS) return null
  const docs = await Promise.all(
    active.map((l) =>
      http()
        .get<Envelope<RawReturn>>(`${BASE}/${seg(l.id)}`, { signal })
        .then((r) => r.data),
    ),
  )
  for (const line of docs.flatMap((d) => d.lines)) {
    const id = line[key]
    if (!id) continue
    out.set(
      id,
      dec(out.get(id) ?? '0')
        .plus(dec(line.quantity))
        .toString(),
    )
  }
  return out
}

export const returnsApi = {
  path: BASE,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<ReturnSummary>>(BASE, { params: toListParams(query), signal }),
  get: (id: string, signal?: AbortSignal) =>
    http()
      .get<ReturnEnvelope>(`${BASE}/${seg(id)}`, { signal })
      .then((r) => one(r, signal)),
  fromInvoice: (invoiceId: string, input: ReturnCreateInput, key: string) =>
    http()
      .post<ReturnEnvelope>(
        `/purchase-invoices/${seg(invoiceId)}/returns`,
        input,
        withIdempotency({}, key),
      )
      .then((r) => one(r)),
  fromReceipt: (receiptId: string, input: ReturnCreateInput, key: string) =>
    http()
      .post<ReturnEnvelope>(
        `/purchase-receipts/${seg(receiptId)}/returns`,
        input,
        withIdempotency({}, key),
      )
      .then((r) => one(r)),
  /** approve (numbers PRT) | ship (stock out) | debit (debit note) | cancel. */
  act: (id: string, action: ReturnAction, version: number, key: string) =>
    http()
      .post<ReturnEnvelope>(`${BASE}/${seg(id)}/${action}`, { version }, withIdempotency({}, key))
      .then((r) => one(r)),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${BASE}/${seg(id)}`, { params: { version } }),
}
