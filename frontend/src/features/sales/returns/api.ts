import type { AuditEntry } from '@/components/shared/AuditTrail'
import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { withIdempotency } from '@/platform'
import { http, seg, toAudit } from '../invoices/kit/http'
import type { Envelope, Paginated } from '../invoices/kit/types'
import type {
  ApiReturn,
  ReturnAction,
  ReturnActionInput,
  ReturnInput,
  ReturnSummary,
} from './types'

export type SalesReturn = Omit<ApiReturn, 'audit'> & { audit?: AuditEntry[] }

export function toReturn(raw: ApiReturn): SalesReturn {
  const { audit, ...rest } = raw
  return {
    ...rest,
    lines: [...raw.lines].sort((a, b) => a.line_no - b.line_no),
    audit: toAudit(raw.id, audit),
  }
}

const BASE = '/sales-returns'
const one = (r: Envelope<ApiReturn>) => toReturn(r.data)

export const returnsApi = {
  path: BASE,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<ReturnSummary>>(BASE, { params: toListParams(query), signal }),
  get: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<ApiReturn>>(`${BASE}/${seg(id)}`, { signal })
      .then(one),
  /** Draft return for lines of an issued invoice (bounded by what is still returnable). */
  createFromInvoice: (invoiceId: string, input: ReturnInput, key: string) =>
    http()
      .post<Envelope<ApiReturn>>(
        `/sales-invoices/${seg(invoiceId)}/returns`,
        input,
        withIdempotency({}, key),
      )
      .then(one),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${BASE}/${seg(id)}`, { params: { version } }),
  /** approve, receive (return_in stock), credit (credit note) or cancel. */
  action: (id: string, action: ReturnAction, input: ReturnActionInput, key: string) =>
    http()
      .post<Envelope<ApiReturn>>(`${BASE}/${seg(id)}/${action}`, input, withIdempotency({}, key))
      .then(one),
}
