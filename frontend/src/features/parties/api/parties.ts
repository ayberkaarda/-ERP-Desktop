import type { AuditEntry } from '@/components/shared/AuditTrail'
import { createFilesApi } from '@/components/shared/attachments'
import { platform, withIdempotency } from '@/platform'
import {
  PARTY_MORPH,
  type ApiActivity,
  type Paginated,
  type Party,
  type PartyDeleteResult,
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
  /**
   * The API needs the version the user saw. A party still referenced elsewhere is deactivated
   * instead (200 with the party and meta.action = deactivated); a free one is gone (204).
   */
  remove: async (id: string, version: number): Promise<PartyDeleteResult> => {
    const res = await platform.http.delete<{
      data?: Party
      meta?: { action?: string; message?: string }
    } | null>(one(id), { params: { version } })
    if (res?.data && res.meta?.action === 'deactivated') {
      return { deactivated: res.data, message: res.meta.message }
    }
    return { deactivated: null }
  },
  duplicates: async (
    query: { tax_number?: string; name?: string; country?: string; exclude_id?: string },
    signal?: AbortSignal,
  ): Promise<PartyDuplicate[]> => {
    const params: Record<string, string> = {}
    if (query.tax_number) params.tax_number = query.tax_number
    if (query.name) params.name = query.name
    if (query.tax_number && query.country) params.country = query.country
    if (query.exclude_id) params.exclude_id = query.exclude_id
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
  /** Not paginated: every row of the party, default/primary first. */
  list: async <T>(partyId: string, kind: SubresourceKind, signal?: AbortSignal) =>
    (await platform.http.get<{ data: T[] }>(subPath(partyId, kind), { signal })).data,
  create: async <T>(partyId: string, kind: SubresourceKind, input: unknown, key: string) =>
    (await platform.http.post<{ data: T }>(subPath(partyId, kind), input, withIdempotency({}, key)))
      .data,
  update: async <T>(partyId: string, kind: SubresourceKind, id: string, input: unknown) =>
    (await platform.http.patch<{ data: T }>(subPath(partyId, kind, id), input)).data,
  /** Needs the version the user saw (409 VERSION_CONFLICT when the row moved on). */
  remove: (partyId: string, kind: SubresourceKind, id: string, version: number) =>
    platform.http.delete<unknown>(subPath(partyId, kind, id), { params: { version } }),
}

export function partyFilesApi(partyId: string) {
  return createFilesApi(platform.http, { type: PARTY_MORPH, id: partyId })
}
