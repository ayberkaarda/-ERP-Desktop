import type { AuditEntry } from '@/components/shared/AuditTrail'
import type { ListQueryState } from '@/components/shared/data-table'
import { ApiError, isApiError, platform } from '@/platform'
import type { ApiAuditRow, Paginated } from './types'

export const http = () => platform.http
export const seg = (id: string) => encodeURIComponent(id)

export type Params = Record<string, string | number>

export const VERSION_CONFLICT = 'VERSION_CONFLICT'
export const CREDIT_LIMIT_EXCEEDED = 'sales.credit_limit_exceeded'
export const LIMIT_EXCEEDED = 'LIMIT_EXCEEDED'

/** Someone else saved the document first (409 VERSION_CONFLICT from HasVersion). */
export function isVersionConflict(error: unknown): boolean {
  return isApiError(error) && error.code === VERSION_CONFLICT
}

/** Credit check in block mode refused the issue (422 sales.credit_limit_exceeded). */
export function isCreditBlocked(error: unknown): boolean {
  return isApiError(error) && error.code === CREDIT_LIMIT_EXCEEDED
}

/** Server text for toasts; the API localizes messages via Accept-Language. */
export function errorMessage(error: unknown, fallback: string): string {
  if (isApiError(error) && error.message) return error.message
  return fallback
}

/** Every page of a list (100 per page); more than `maxPages` pages throws LIMIT_EXCEEDED. */
export async function fetchAll<T>(
  url: string,
  params: Params = {},
  signal?: AbortSignal,
  maxPages = 20,
): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; ; page++) {
    const res = await http().get<Paginated<T>>(url, {
      params: { ...params, page, per_page: 100 },
      signal,
    })
    if (res.meta.pagination.last_page > maxPages) {
      throw new ApiError(0, LIMIT_EXCEEDED, `More than ${maxPages * 100} rows.`)
    }
    out.push(...res.data)
    if (page >= res.meta.pagination.last_page || res.data.length === 0) break
  }
  return out
}

/** The API names only the causer; the audit trail wants its entry shape. */
export function toAudit(docId: string, rows: ApiAuditRow[] | undefined): AuditEntry[] | undefined {
  return rows?.map((a, i) => ({
    id: `${docId}-a${i}`,
    event: a.event,
    description: a.description,
    causer: a.causer_id ? { id: a.causer_id, name: a.causer_name ?? '' } : null,
    created_at: a.created_at ?? '',
    properties: null,
  }))
}

/** List filters as export parameters (same names as the list: q and filter[x]). */
export function exportParams(query: ListQueryState): Record<string, string> {
  const out: Record<string, string> = {}
  if (query.q) out.q = query.q
  for (const [k, v] of Object.entries(query.filters)) if (v !== '') out[`filter[${k}]`] = v
  return out
}

/** `errors.details` of a credit block (sales.credit_limit_exceeded), in the risk currency. */
export interface CreditBreakdown {
  limit: string | null
  currency: string
  exposure: string
  document: string
  total: string
  available: string | null
}

/** The credit check breakdown carried by a block-mode refusal, when the API sent it. */
export function creditBreakdown(error: unknown): CreditBreakdown | null {
  if (!isCreditBlocked(error)) return null
  const details = (error as { details?: unknown }).details
  if (!details || typeof details !== 'object') return null
  const d = details as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null)
  const currency = s(d.currency)
  const exposure = s(d.exposure)
  const document = s(d.document)
  const total = s(d.total)
  if (!currency || exposure === null || document === null || total === null) return null
  return { limit: s(d.limit), currency, exposure, document, total, available: s(d.available) }
}
