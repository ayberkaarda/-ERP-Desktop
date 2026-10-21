import type { AuditEntry } from '@/components/shared/AuditTrail'
import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { withIdempotency } from '@/platform'
import { http, seg, toAudit } from './kit/http'
import type { CustomerExposure, DocWarning, Envelope, Paginated } from './kit/types'
import type {
  ApiInvoice,
  InvoiceFromSourceInput,
  InvoiceInput,
  InvoiceReverseInput,
  InvoiceSummary,
  IssueInput,
  PreviewInput,
  PreviewResult,
} from './types'

export type Invoice = Omit<ApiInvoice, 'audit'> & { audit?: AuditEntry[] }

export function toInvoice(raw: ApiInvoice): Invoice {
  const { audit, ...rest } = raw
  return {
    ...rest,
    lines: [...raw.lines].sort((a, b) => a.line_no - b.line_no),
    audit: toAudit(raw.id, audit),
  }
}

/** Issue answers the invoice plus credit warnings (warn mode) in meta.warnings. */
export interface IssueResult {
  invoice: Invoice
  warnings: DocWarning[]
}

const BASE = '/sales-invoices'
type InvoiceEnvelope = Envelope<ApiInvoice, { warnings?: DocWarning[] }>
const one = (r: InvoiceEnvelope) => toInvoice(r.data)

export const invoicesApi = {
  path: BASE,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<InvoiceSummary>>(BASE, { params: toListParams(query), signal }),
  get: (id: string, signal?: AbortSignal) =>
    http()
      .get<InvoiceEnvelope>(`${BASE}/${seg(id)}`, { signal })
      .then(one),
  create: (input: InvoiceInput, key: string) =>
    http().post<InvoiceEnvelope>(BASE, input, withIdempotency({}, key)).then(one),
  update: (id: string, input: InvoiceInput & { version: number }) =>
    http()
      .patch<InvoiceEnvelope>(`${BASE}/${seg(id)}`, input)
      .then(one),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${BASE}/${seg(id)}`, { params: { version } }),
  /** Assigns the gapless number and posts the journal entry; idempotent by key and by state. */
  issue: (id: string, input: IssueInput, key: string) =>
    http()
      .post<InvoiceEnvelope>(`${BASE}/${seg(id)}/issue`, input, withIdempotency({}, key))
      .then((r): IssueResult => ({ invoice: toInvoice(r.data), warnings: r.meta?.warnings ?? [] })),
  reverse: (id: string, input: InvoiceReverseInput, key: string) =>
    http()
      .post<InvoiceEnvelope>(`${BASE}/${seg(id)}/reverse`, input, withIdempotency({}, key))
      .then(one),
  /** Invoice draft for a posted delivery (its uninvoiced lines). */
  fromDelivery: (deliveryId: string, input: InvoiceFromSourceInput, key: string) =>
    http()
      .post<InvoiceEnvelope>(
        `/sales-deliveries/${seg(deliveryId)}/invoice`,
        input,
        withIdempotency({}, key),
      )
      .then(one),
  preview: (input: PreviewInput, signal?: AbortSignal) =>
    http()
      .post<Envelope<PreviewResult>>('/sales-documents/preview-totals', input, { signal })
      .then((r) => r.data),
  exposure: (partyId: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<CustomerExposure>>(`/customers/${seg(partyId)}/exposure`, { signal })
      .then((r) => r.data),
}
