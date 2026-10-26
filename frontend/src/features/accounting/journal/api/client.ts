import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { ApiError, platform, withIdempotency } from '@/platform'
import type {
  AccountingPeriod,
  AccountRef,
  ApiJournalEntry,
  EntryLink,
  Envelope,
  JournalEntry,
  JournalEntryInput,
  JournalEntrySummary,
  JournalLine,
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

export type RefResource = 'parties' | 'cost-centers' | 'projects'

/** Records the caller already holds (the editor's picked accounts and dimensions). */
export interface KnownRecords {
  accounts?: ReadonlyMap<string, AccountRef>
  /** Keyed by refKey(resource, id). */
  refs?: ReadonlyMap<string, NamedRef>
}

export const refKey = (resource: RefResource, id: string) => `${resource}:${id}`

/** A lookup that may fail (no permission, deleted record): null, unless the request was aborted. */
async function settle<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  try {
    return await promise
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  }
}

/** Runs `fn` over `items` with at most `limit` requests in flight. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const DIMENSIONS = [
  ['party_id', 'party', 'parties'],
  ['cost_center_id', 'cost_center', 'cost-centers'],
  ['project_id', 'project', 'projects'],
] as const

/**
 * The API sends lines with account code/name and dimension ids only. The editor needs each
 * account's posting flags and the view shows dimension labels, so the records are looked up
 * here (known ones are reused); a failed lookup leaves a minimal record built from the line.
 */
export async function enrichEntry(
  raw: ApiJournalEntry,
  known: KnownRecords = {},
  signal?: AbortSignal,
): Promise<JournalEntry> {
  const accounts = new Map(known.accounts ?? [])
  const refs = new Map(known.refs ?? [])
  const missingAccounts = [...new Set(raw.lines.map((l) => l.account_id))].filter(
    (id) => id && !accounts.has(id),
  )
  const missingRefs = [
    ...new Map(
      raw.lines.flatMap((l) =>
        DIMENSIONS.flatMap(([field, , resource]) => {
          const id = l[field]
          return id && !refs.has(refKey(resource, id))
            ? [[refKey(resource, id), [resource, id] as const] as const]
            : []
        }),
      ),
    ).values(),
  ]
  const linkIds = [raw.reverses_id, raw.reversed_by_id].filter((id): id is string => Boolean(id))

  const [fetchedAccounts, fetchedRefs, links] = await Promise.all([
    mapLimit(missingAccounts, 6, (id) => settle(lookupsApi.account(id, signal), signal)),
    mapLimit(missingRefs, 6, ([resource, id]) =>
      settle(lookupsApi.ref(resource, id, signal), signal),
    ),
    Promise.all(linkIds.map((id) => settle(journalApi.getRaw(id, signal), signal))),
  ])
  missingAccounts.forEach((id, i) => {
    const found = fetchedAccounts[i]
    if (found) accounts.set(id, found)
  })
  missingRefs.forEach(([resource, id], i) => {
    const found = fetchedRefs[i]
    if (found) refs.set(refKey(resource, id), found)
  })
  const linkOf = (id: string | null): EntryLink | null => {
    if (!id) return null
    const found = links.find((l) => l?.id === id)
    return { id, number: found?.number ?? null, entry_date: found?.entry_date }
  }

  const { audit, lines, ...rest } = raw
  return {
    ...rest,
    lines: lines.map((l): JournalLine => {
      const out: JournalLine = {
        ...l,
        account: accounts.get(l.account_id) ?? {
          id: l.account_id,
          code: l.account_code ?? '',
          name: l.account_name ?? '',
          currency_code: l.currency_code,
          requires_party: false,
          requires_cost_center: false,
          requires_project: false,
        },
      }
      for (const [field, key, resource] of DIMENSIONS) {
        const id = l[field]
        out[key] = id ? (refs.get(refKey(resource, id)) ?? null) : null
      }
      return out
    }),
    reverses: linkOf(raw.reverses_id),
    reversed_by: linkOf(raw.reversed_by_id),
    // The API names only the causer id; the view labels the user.
    audit: audit?.map((a, i) => ({
      id: `${raw.id}-a${i}`,
      event: a.event,
      description: a.description,
      causer: a.causer_id ? { id: a.causer_id, name: '' } : null,
      created_at: a.created_at ?? '',
      properties: null,
    })),
  }
}

const ENTRIES = '/journal-entries'

export const journalApi = {
  list: (query: ListQueryState, signal?: AbortSignal) =>
    http().get<Paginated<JournalEntrySummary>>(ENTRIES, { params: toListParams(query), signal }),
  /** The entry as the API sends it (no lookups). */
  getRaw: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<ApiJournalEntry>>(`${ENTRIES}/${seg(id)}`, { signal })
      .then((r) => r.data),
  get: async (id: string, signal?: AbortSignal) =>
    enrichEntry(await journalApi.getRaw(id, signal), {}, signal),
  create: async (input: JournalEntryInput, idempotencyKey: string, known?: KnownRecords) =>
    enrichEntry(
      (
        await http().post<Envelope<ApiJournalEntry>>(
          ENTRIES,
          input,
          withIdempotency({}, idempotencyKey),
        )
      ).data,
      known,
    ),
  update: async (
    id: string,
    input: JournalEntryInput & { version: number },
    known?: KnownRecords,
  ) =>
    enrichEntry(
      (await http().patch<Envelope<ApiJournalEntry>>(`${ENTRIES}/${seg(id)}`, input)).data,
      known,
    ),
  post: async (id: string, version: number, idempotencyKey: string, known?: KnownRecords) =>
    enrichEntry(
      (
        await http().post<Envelope<ApiJournalEntry>>(
          `${ENTRIES}/${seg(id)}/post`,
          { version },
          withIdempotency({}, idempotencyKey),
        )
      ).data,
      known,
    ),
  /** Returns the new reversal entry; the original becomes `reversed`. */
  reverse: async (id: string, input: ReverseInput & { version?: number }, idempotencyKey: string) =>
    enrichEntry(
      (
        await http().post<Envelope<ApiJournalEntry>>(
          `${ENTRIES}/${seg(id)}/reverse`,
          input,
          withIdempotency({}, idempotencyKey),
        )
      ).data,
    ),
  remove: (id: string, version: number) =>
    http().delete<unknown>(`${ENTRIES}/${seg(id)}`, { params: { version } }),
}

/** Records an entry carries, for reuse by enrichEntry after a save or post. */
export function knownRecordsOf(entry: Pick<JournalEntry, 'lines'>): KnownRecords {
  const accounts = new Map<string, AccountRef>()
  const refs = new Map<string, NamedRef>()
  for (const l of entry.lines) {
    if (l.account?.code) accounts.set(l.account_id, l.account)
    for (const [field, key, resource] of DIMENSIONS) {
      const id = l[field]
      const record = l[key]
      if (id && record) refs.set(refKey(resource, id), record)
    }
  }
  return { accounts, refs }
}

interface FiscalYearCode {
  id: string
  code: string
}

/** Lookups owned by other modules, read through their public endpoints. */
export const lookupsApi = {
  account: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<AccountRef>>(`/accounts/${seg(id)}`, { signal })
      .then((r) => r.data),
  /** parties, cost-centers, projects: code + name search. */
  refs: (path: RefResource, q: string, signal?: AbortSignal) =>
    http()
      .get<Paginated<NamedRef>>(`/${path}`, { params: { q, per_page: 20 }, signal })
      .then((r) => r.data),
  ref: (path: RefResource, id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<NamedRef>>(`/${path}/${seg(id)}`, { signal })
      .then((r) => r.data),
  /** Periods in date order, labelled with their fiscal year code when the years can be read. */
  periods: async (signal?: AbortSignal) => {
    const [periods, years] = await Promise.all([
      fetchAll<AccountingPeriod>('/accounting-periods', { sort: 'start_date' }, signal),
      settle(fetchAll<FiscalYearCode>('/fiscal-years', {}, signal), signal),
    ])
    const codes = new Map((years ?? []).map((y) => [y.id, y.code]))
    return periods.map((p) => ({ ...p, fiscal_year_code: codes.get(p.fiscal_year_id) ?? null }))
  },
}
