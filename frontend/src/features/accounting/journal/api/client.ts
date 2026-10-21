import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { ApiError, platform, withIdempotency } from '@/platform'
import type {
  AccountingPeriod,
  AccountRef,
  Envelope,
  JournalEntry,
  JournalEntryInput,
  JournalEntrySummary,
  NamedRef,
  Paginated,
  ReverseInput,
} from '../types'

const http = () => platform.http
const seg = (id: string) => encodeURIComponent(id)

export type Params = Record<string, string | number>

export const LIMIT_EXCEEDED = 'LIMIT_EXCEEDED'

/** Every page of a list (100 per page); more than `maxPages` pages throws LIMIT_EXCEEDED. */
export async function fetchAll<T>(
  url: string,
  params: Params = {},
  signal?: AbortSignal,
  maxPages = 50,
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

const ENTRIES = '/journal-entries'

export const journalApi = {
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<JournalEntrySummary>>(ENTRIES, { params: toListParams(query), signal }),
  get: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<JournalEntry>>(`${ENTRIES}/${seg(id)}`, { signal })
      .then((r) => r.data),
  create: (input: JournalEntryInput, idempotencyKey: string) =>
    http()
      .post<Envelope<JournalEntry>>(ENTRIES, input, withIdempotency({}, idempotencyKey))
      .then((r) => r.data),
  update: (id: string, input: JournalEntryInput & { version: number }) =>
    http()
      .patch<Envelope<JournalEntry>>(`${ENTRIES}/${seg(id)}`, input)
      .then((r) => r.data),
  post: (id: string, version: number, idempotencyKey: string) =>
    http()
      .post<Envelope<JournalEntry>>(
        `${ENTRIES}/${seg(id)}/post`,
        { version },
        withIdempotency({}, idempotencyKey),
      )
      .then((r) => r.data),
  /** Returns the new reversal entry; the original becomes `reversed`. */
  reverse: (id: string, input: ReverseInput, idempotencyKey: string) =>
    http()
      .post<Envelope<JournalEntry>>(
        `${ENTRIES}/${seg(id)}/reverse`,
        input,
        withIdempotency({}, idempotencyKey),
      )
      .then((r) => r.data),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${ENTRIES}/${seg(id)}`, { params: { version } }),
}

/** Lookups owned by other modules, read through their public endpoints. */
export const lookupsApi = {
  accounts: (q: string, options: { postableOnly?: boolean }, signal?: AbortSignal) =>
    http()
      .get<Paginated<AccountRef>>('/accounts', {
        params: {
          q,
          per_page: 20,
          sort: 'code',
          'filter[active]': 1,
          ...(options.postableOnly === false ? {} : { 'filter[postable]': 1 }),
        },
        signal,
      })
      .then((r) => r.data),
  account: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<AccountRef>>(`/accounts/${seg(id)}`, { signal })
      .then((r) => r.data),
  /** parties, cost-centers, projects: code + name search. */
  refs: (path: 'parties' | 'cost-centers' | 'projects', q: string, signal?: AbortSignal) =>
    http()
      .get<Paginated<NamedRef>>(`/${path}`, { params: { q, per_page: 20 }, signal })
      .then((r) => r.data),
  ref: (path: 'parties' | 'cost-centers' | 'projects', id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<NamedRef>>(`/${path}/${seg(id)}`, { signal })
      .then((r) => r.data),
  periods: (signal?: AbortSignal) =>
    fetchAll<AccountingPeriod>('/accounting-periods', { sort: 'start_date' }, signal),
}
