import { platform, withIdempotency } from '@/platform'
import type {
  CreateDocument,
  Direction,
  EDocument,
  Kind,
  Page,
  ProviderStatus,
  Source,
  Taxpayer,
  Alias,
} from './types'
const base = '/e-documents'
interface Envelope<T> {
  data: T
}
export const edocumentsApi = {
  status: (signal?: AbortSignal) =>
    platform.http.get<Envelope<ProviderStatus>>(`${base}/status`, { signal }).then((r) => r.data),
  list: (
    params: { direction: Direction; kind?: Kind; status?: string; search?: string; page: number },
    signal?: AbortSignal,
  ) =>
    platform.http.get<Page<EDocument>>(`${base}/documents`, {
      params: { ...params, search: params.search?.trim() ? params.search.trim() : undefined },
      signal,
    }),
  sources: (kind: Kind, search: string, page: number, signal?: AbortSignal) =>
    platform.http.get<Page<Source>>(`${base}/sources`, {
      params: { kind, search: search.trim() || undefined, page },
      signal,
    }),
  get: (id: string, signal?: AbortSignal) =>
    platform.http
      .get<Envelope<EDocument>>(`${base}/documents/${encodeURIComponent(id)}`, { signal })
      .then((r) => r.data),
  create: (body: CreateDocument, key: string, signal?: AbortSignal) =>
    platform.http
      .post<Envelope<EDocument>>(`${base}/documents`, body, withIdempotency({ signal }, key))
      .then((r) => r.data),
  update: (
    id: string,
    body: { version: number; metadata: Record<string, unknown>; profile: string; series: string },
    key: string,
    signal?: AbortSignal,
  ) =>
    platform.http
      .patch<Envelope<EDocument>>(
        `${base}/documents/${encodeURIComponent(id)}`,
        body,
        withIdempotency({ signal }, key),
      )
      .then((r) => r.data),
  action: (
    id: string,
    action: 'validate' | 'send' | 'retry' | 'poll' | 'respond' | 'link-purchase' | 'cancel',
    body: Record<string, unknown>,
    key: string,
    signal?: AbortSignal,
  ) =>
    platform.http
      .post<Envelope<EDocument>>(
        `${base}/documents/${encodeURIComponent(id)}/${action}`,
        body,
        withIdempotency({ signal }, key),
      )
      .then((r) => r.data),
  xml: (id: string, signal?: AbortSignal) =>
    platform.http.download(`${base}/documents/${encodeURIComponent(id)}/xml`, { signal }),
  taxpayers: (taxNumber: string, signal?: AbortSignal) =>
    platform.http
      .get<Envelope<Taxpayer>>(`${base}/taxpayers`, { params: { tax_number: taxNumber }, signal })
      .then((r) => r.data),
  directory: (
    body: { tax_number: string; name: string; aliases: Alias[] },
    key: string,
    signal?: AbortSignal,
  ) =>
    platform.http
      .post<Envelope<Taxpayer>>(`${base}/sandbox/taxpayers`, body, withIdempotency({ signal }, key))
      .then((r) => r.data),
  importXml: (xml: string, key: string, signal?: AbortSignal) =>
    platform.http
      .post<Envelope<EDocument>>(`${base}/inbox/import`, { xml }, withIdempotency({ signal }, key))
      .then((r) => r.data),
  pollInbox: (key: string, signal?: AbortSignal) =>
    platform.http
      .post<
        Envelope<{
          imported: number
          documents: EDocument[]
          errors?: { id: string; message: string }[]
        }>
      >(`${base}/inbox/poll`, {}, withIdempotency({ signal }, key))
      .then((r) => r.data),
  stage: (xml: string, key: string, signal?: AbortSignal) =>
    platform.http
      .post<Envelope<{ id: string }>>(
        `${base}/sandbox/inbox`,
        { xml },
        withIdempotency({ signal }, key),
      )
      .then((r) => r.data),
  outcome: (id: string, outcome: string, version: number, key: string, signal?: AbortSignal) =>
    platform.http
      .post<Envelope<EDocument>>(
        `${base}/sandbox/documents/${encodeURIComponent(id)}/outcome`,
        { version, outcome },
        withIdempotency({ signal }, key),
      )
      .then((r) => r.data),
  purchaseInvoices: (search: string, page: number, signal?: AbortSignal) =>
    platform.http.get<
      Page<{
        id: string
        number: string | null
        party_name: string
        currency_code: string
        total: string
      }>
    >('/purchase-invoices', { params: { q: search, page, per_page: 25 }, signal }),
}
