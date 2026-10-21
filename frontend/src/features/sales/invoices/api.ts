import type { AuditEntry } from '@/components/shared/AuditTrail'
import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { withIdempotency } from '@/platform'
import { http, seg } from './kit/http'
import { labelLines, normalizeHeader } from './kit/normalize'
import type { CustomerExposure, DocWarning, Envelope, Paginated } from './kit/types'
import type {
  InvoiceDetail,
  InvoiceFromDeliveryInput,
  InvoiceInput,
  InvoiceReverseInput,
  InvoiceSummary,
  IssueInput,
  PreviewInput,
  PreviewResult,
  RawInvoice,
  RawPreview,
} from './types'

export type Invoice = Omit<InvoiceDetail, 'audit'> & { audit?: AuditEntry[] }

/** Detail as the screens use it: party snapshot, chain list, labelled lines. */
export async function toInvoice(raw: RawInvoice, signal?: AbortSignal): Promise<Invoice> {
  const head = normalizeHeader(raw)
  const lines = await labelLines(
    [...raw.lines].sort((a, b) => a.line_no - b.line_no),
    signal,
  )
  return { ...head, lines }
}

/** Issue answers the invoice plus credit warnings (warn mode or override) in meta.warnings. */
export interface IssueResult {
  invoice: Invoice
  warnings: DocWarning[]
  /** The invoice was already issued (idempotent by state): nothing was booked again. */
  replayed: boolean
}

const BASE = '/sales-invoices'
type InvoiceEnvelope = Envelope<RawInvoice, { warnings?: DocWarning[]; replayed?: boolean }>
const one = (r: InvoiceEnvelope, signal?: AbortSignal) => toInvoice(r.data, signal)

/** preview-totals answers `{header, lines, taxes, totals}`; the editor wants flat totals. */
export function toPreview(raw: RawPreview, warnings: DocWarning[] = []): PreviewResult {
  return {
    ...raw.totals,
    lines: raw.lines.map((l) => ({
      unit_price: l.unit_price,
      price_source: l.price_source,
      tax_rate: l.tax_rate,
      net_amount: l.net_amount,
      tax_amount: l.tax_amount,
      line_total: l.line_total,
    })),
    warnings,
  }
}

export const invoicesApi = {
  path: BASE,
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<InvoiceSummary>>(BASE, { params: toListParams(query), signal }),
  get: (id: string, signal?: AbortSignal) =>
    http()
      .get<InvoiceEnvelope>(`${BASE}/${seg(id)}`, { signal })
      .then((r) => one(r, signal)),
  create: (input: InvoiceInput, key: string) =>
    http()
      .post<InvoiceEnvelope>(BASE, input, withIdempotency({}, key))
      .then((r) => one(r)),
  update: (id: string, input: InvoiceInput & { version: number }) =>
    http()
      .patch<InvoiceEnvelope>(`${BASE}/${seg(id)}`, input)
      .then((r) => one(r)),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${BASE}/${seg(id)}`, { params: { version } }),
  /** Assigns the gapless number and posts the journal entry; idempotent by key and by state. */
  issue: (id: string, input: IssueInput, key: string) =>
    http()
      .post<InvoiceEnvelope>(`${BASE}/${seg(id)}/issue`, input, withIdempotency({}, key))
      .then(async (r): Promise<IssueResult> => ({
        invoice: await toInvoice(r.data),
        warnings: r.meta?.warnings ?? [],
        replayed: r.meta?.replayed === true,
      })),
  reverse: (id: string, input: InvoiceReverseInput, key: string) =>
    http()
      .post<InvoiceEnvelope>(`${BASE}/${seg(id)}/reverse`, input, withIdempotency({}, key))
      .then((r) => one(r)),
  /** Draft invoice: nothing posted yet, so it is simply cancelled. */
  cancel: (id: string, version: number, key: string) =>
    http()
      .post<InvoiceEnvelope>(`${BASE}/${seg(id)}/cancel`, { version }, withIdempotency({}, key))
      .then((r) => one(r)),
  /** Invoice draft for a posted delivery (its uninvoiced lines). */
  fromDelivery: (deliveryId: string, input: InvoiceFromDeliveryInput, key: string) =>
    http()
      .post<InvoiceEnvelope>(
        `/sales-deliveries/${seg(deliveryId)}/invoice`,
        input,
        withIdempotency({}, key),
      )
      .then((r) => one(r)),
  preview: (input: PreviewInput, signal?: AbortSignal) =>
    http()
      .post<Envelope<RawPreview, { warnings?: DocWarning[] }>>(
        '/sales-documents/preview-totals',
        input,
        { signal },
      )
      .then((r) => toPreview(r.data, r.meta?.warnings ?? [])),
  /** With documentId the answer also carries document_amount in the risk currency. */
  exposure: (partyId: string, signal?: AbortSignal, documentId?: string) =>
    http()
      .get<Envelope<CustomerExposure>>(`/customers/${seg(partyId)}/exposure`, {
        params: documentId ? { document_id: documentId } : undefined,
        signal,
      })
      .then((r) => r.data),
}
