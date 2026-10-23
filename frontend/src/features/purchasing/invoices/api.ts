import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { withIdempotency } from '@/platform'
import { http, seg } from './kit/http'
import { labelSorted, normalizeHeader } from './kit/normalize'
import type { DocWarning, Envelope, Paginated, SupplierExposure } from './kit/types'
import { parseMatch, type MatchResult } from './lib/match'
import type {
  BookInput,
  Invoice,
  InvoiceFromReceiptInput,
  InvoiceInput,
  InvoiceSummary,
  PreviewInput,
  PreviewLine,
  PreviewResult,
  RawInvoice,
  RawPreview,
  ReverseInput,
} from './types'

/** Detail as the screens use it: supplier snapshot, chain, labelled lines and the match. */
export async function toInvoice(raw: RawInvoice, signal?: AbortSignal): Promise<Invoice> {
  const { match, ...rest } = raw
  const head = normalizeHeader(rest)
  const lines = await labelSorted(raw.lines, signal)
  return { ...head, lines, match: parseMatch(match) }
}

/** Book answers the invoice plus match / approval notes in meta.warnings. */
export interface BookResult {
  invoice: Invoice
  warnings: DocWarning[]
  /** The invoice was already booked (idempotent by state): nothing was posted again. */
  replayed: boolean
}

const BASE = '/purchase-invoices'
type InvoiceEnvelope = Envelope<RawInvoice, { warnings?: DocWarning[]; replayed?: boolean }>
const one = (r: InvoiceEnvelope, signal?: AbortSignal) => toInvoice(r.data, signal)

const s = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null

/** preview-totals answers `{header, lines, taxes, totals}`; the editor wants flat totals. */
export function toPreview(raw: RawPreview, warnings: DocWarning[] = []): PreviewResult {
  return {
    ...raw.totals,
    lines: raw.lines.map((l): PreviewLine => ({
      unit_price: s(l.unit_price) ?? '0',
      price_source: s(l.price_source),
      tax_rate: s(l.tax_rate) ?? '0',
      withholding_rate: s(l.withholding_rate),
      net_amount: s(l.net_amount),
      tax_amount: s(l.tax_amount),
      withholding_amount: s(l.withholding_amount),
      line_total: s(l.line_total),
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
  /** Draft only: stored once booked, computed for drafts. */
  match: (id: string, signal?: AbortSignal): Promise<MatchResult | null> =>
    http()
      .get<Envelope<unknown>>(`${BASE}/${seg(id)}/match`, { signal })
      .then((r) => parseMatch(r.data)),
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
  /**
   * Numbers (PIN/PDN) and posts the journal entry; above the approval threshold it goes to
   * pending_approval instead. Idempotent by key and by state (meta.replayed).
   */
  book: (id: string, input: BookInput, key: string) =>
    http()
      .post<InvoiceEnvelope>(`${BASE}/${seg(id)}/book`, input, withIdempotency({}, key))
      .then(async (r): Promise<BookResult> => ({
        invoice: await toInvoice(r.data),
        warnings: r.meta?.warnings ?? [],
        replayed: r.meta?.replayed === true,
      })),
  reverse: (id: string, input: ReverseInput, key: string) =>
    http()
      .post<InvoiceEnvelope>(`${BASE}/${seg(id)}/reverse`, input, withIdempotency({}, key))
      .then((r) => one(r)),
  /** Draft or pending invoice: nothing posted yet, so it is simply cancelled. */
  cancel: (id: string, version: number, key: string) =>
    http()
      .post<InvoiceEnvelope>(`${BASE}/${seg(id)}/cancel`, { version }, withIdempotency({}, key))
      .then((r) => one(r)),
  /** Invoice draft for a posted receipt (its lines still open). */
  fromReceipt: (receiptId: string, input: InvoiceFromReceiptInput, key: string) =>
    http()
      .post<InvoiceEnvelope>(
        `/purchase-receipts/${seg(receiptId)}/invoice`,
        input,
        withIdempotency({}, key),
      )
      .then((r) => one(r)),
  preview: (input: PreviewInput, signal?: AbortSignal) =>
    http()
      .post<Envelope<RawPreview, { warnings?: DocWarning[] }>>(
        '/purchase-documents/preview-totals',
        input,
        { signal },
      )
      .then((r) => toPreview(r.data, r.meta?.warnings ?? [])),
  exposure: (partyId: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<SupplierExposure>>(`/suppliers/${seg(partyId)}/exposure`, { signal })
      .then((r) => r.data),
}
