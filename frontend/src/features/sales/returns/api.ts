import Decimal from 'decimal.js'
import type { AuditEntry } from '@/components/shared/AuditTrail'
import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { withIdempotency } from '@/platform'
import { http, seg } from '../invoices/kit/http'
import { labelLines, linkNamed, normalizeHeader } from '../invoices/kit/normalize'
import type { DocLink, Envelope, Paginated } from '../invoices/kit/types'
import type {
  RawReturn,
  ReturnAction,
  ReturnActionInput,
  ReturnDetail,
  ReturnInput,
  ReturnSummary,
} from './types'

export type SalesReturn = Omit<ReturnDetail, 'audit'> & { audit?: AuditEntry[] }

/** Detail as the screens use it: snapshot, chain list, labelled lines, linked numbers. */
export async function toReturn(raw: RawReturn, signal?: AbortSignal): Promise<SalesReturn> {
  const head = normalizeHeader(raw)
  const lines = await labelLines(
    [...raw.lines].sort((a, b) => a.line_no - b.line_no),
    signal,
  )
  return {
    ...head,
    invoice_number: linkNamed(raw.links, 'invoice')?.number ?? null,
    credit_invoice_number: linkNamed(raw.links, 'credit_invoice')?.number ?? null,
    lines: lines.map((l) => ({ ...l, serial_numbers: l.serial_numbers ?? [] })),
  }
}

const BASE = '/sales-returns'
const one = (r: Envelope<RawReturn>, signal?: AbortSignal) => toReturn(r.data, signal)

/**
 * Quantity per invoice line already on other (non-cancelled) returns of the invoice: the server
 * bounds a new return by invoiced minus these, so the selection shows the same figure.
 */
export async function returnedPerLine(
  links: readonly DocLink[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const active = links.filter(
    (l) => l.type === 'sales_return' && l.relation === 'target' && l.status !== 'cancelled',
  )
  const out = new Map<string, Decimal>()
  const docs = await Promise.all(
    active.map((l) =>
      http()
        .get<Envelope<{ lines: { invoice_line_id: string; quantity: string }[] }>>(
          `${BASE}/${seg(l.id)}`,
          { signal },
        )
        .then((r) => r.data),
    ),
  )
  for (const line of docs.flatMap((d) => d.lines))
    out.set(
      line.invoice_line_id,
      (out.get(line.invoice_line_id) ?? new Decimal(0)).plus(line.quantity),
    )
  return Object.fromEntries([...out].map(([k, v]) => [k, v.toString()]))
}

export const returnsApi = {
  path: BASE,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<ReturnSummary>>(BASE, { params: toListParams(query), signal }),
  get: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<RawReturn>>(`${BASE}/${seg(id)}`, { signal })
      .then((r) => one(r, signal)),
  /** Draft return for lines of an issued invoice (bounded by what is still returnable). */
  createFromInvoice: (invoiceId: string, input: ReturnInput, key: string) =>
    http()
      .post<Envelope<RawReturn>>(
        `/sales-invoices/${seg(invoiceId)}/returns`,
        input,
        withIdempotency({}, key),
      )
      .then((r) => one(r)),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${BASE}/${seg(id)}`, { params: { version } }),
  /** approve (numbered), receive (return_in stock), credit (credit note) or cancel. */
  action: (id: string, action: ReturnAction, input: ReturnActionInput, key: string) =>
    http()
      .post<Envelope<RawReturn>>(`${BASE}/${seg(id)}/${action}`, input, withIdempotency({}, key))
      .then((r) => one(r)),
}
