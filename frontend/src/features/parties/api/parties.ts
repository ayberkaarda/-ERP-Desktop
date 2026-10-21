import type { AuditEntry } from '@/components/shared/AuditTrail'
import { createFilesApi } from '@/components/shared/attachments'
import { platform, withIdempotency, type HttpRequestOptions } from '@/platform'
import {
  PARTY_MORPH,
  type ApiActivity,
  type Paginated,
  type Party,
  type PartyDuplicate,
  type PartyInput,
  type PartyPatch,
} from '../types'

const base = '/parties'
const one = (id: string) => `${base}/${encodeURIComponent(id)}`

export type ListParams = Record<string, string | number>

export const partiesApi = {
  list: (params: ListParams, signal?: AbortSignal) =>
    platform.http.get<Paginated<Party>>(base, { params, signal }),
  get: async (id: string, signal?: AbortSignal) =>
    (await platform.http.get<{ data: Party }>(one(id), { signal })).data,
  /** `idempotencyKey` is kept by the caller per logical submit, so a retry replays. */
  create: async (input: PartyInput, idempotencyKey: string) =>
    (await platform.http.post<{ data: Party }>(base, input, withIdempotency({}, idempotencyKey)))
      .data,
  update: async (id: string, patch: PartyPatch) =>
    (await platform.http.patch<{ data: Party }>(one(id), patch)).data,
  remove: (id: string) => platform.http.delete<unknown>(one(id)),
  duplicates: async (
    query: { tax_number?: string; name?: string },
    signal?: AbortSignal,
  ): Promise<PartyDuplicate[]> => {
    const params: Record<string, string> = {}
    if (query.tax_number) params.tax_number = query.tax_number
    if (query.name) params.name = query.name
    return (
      await platform.http.get<{ data: PartyDuplicate[] }>(`${base}/duplicates`, {
        params,
        signal,
      })
    ).data
  },
  /** Combobox search: active parties by name/code/tax number, optionally one role. */
  search: async (q: string, options: { role?: string; signal?: AbortSignal } = {}) => {
    const params: ListParams = { q, per_page: 20, sort: 'name', 'filter[is_active]': '1' }
    if (options.role) params['filter[role]'] = options.role
    return (await partiesApi.list(params, options.signal)).data
  },
  audit: async (id: string, page: number, signal?: AbortSignal) => {
    const res = await platform.http.get<Paginated<ApiActivity>>('/logs/audit', {
      params: {
        'filter[subject_type]': PARTY_MORPH,
        'filter[subject_id]': id,
        sort: '-created_at',
        per_page: 20,
        page,
      },
      signal,
    })
    return {
      entries: res.data.map(toAuditEntry),
      lastPage: res.meta?.pagination?.last_page ?? page,
    }
  },
}

export function toAuditEntry(a: ApiActivity): AuditEntry {
  return {
    id: a.id,
    event: a.event,
    description: a.description,
    causer: a.causer ?? null,
    created_at: a.created_at,
    properties: { attributes: a.attributes ?? undefined, old: a.old ?? undefined },
  }
}

export type SubresourceKind = 'addresses' | 'contacts' | 'bank-accounts'

const subPath = (partyId: string, kind: SubresourceKind, id?: string) =>
  `${one(partyId)}/${kind}${id ? `/${encodeURIComponent(id)}` : ''}`

export const subresourceApi = {
  list: async <T>(partyId: string, kind: SubresourceKind, signal?: AbortSignal) =>
    (
      await platform.http.get<{ data: T[] }>(subPath(partyId, kind), {
        params: { per_page: 100 },
        signal,
      })
    ).data,
  create: async <T>(partyId: string, kind: SubresourceKind, input: unknown, key: string) =>
    (await platform.http.post<{ data: T }>(subPath(partyId, kind), input, withIdempotency({}, key)))
      .data,
  update: async <T>(partyId: string, kind: SubresourceKind, id: string, input: unknown) =>
    (await platform.http.patch<{ data: T }>(subPath(partyId, kind, id), input)).data,
  remove: (partyId: string, kind: SubresourceKind, id: string) =>
    platform.http.delete<unknown>(subPath(partyId, kind, id)),
}

/** File uploads opt in to idempotency on the API, so every POST carries a fresh key. */
const filesHttp = {
  get: platform.http.get.bind(platform.http),
  delete: platform.http.delete.bind(platform.http),
  post: <T>(url: string, body?: unknown, options?: HttpRequestOptions) =>
    platform.http.post<T>(url, body, withIdempotency(options)),
}

export function partyFilesApi(partyId: string) {
  return createFilesApi(filesHttp, { type: PARTY_MORPH, id: partyId })
}
