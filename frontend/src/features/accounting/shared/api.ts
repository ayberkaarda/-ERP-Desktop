import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { ApiError, isApiError, platform, withIdempotency } from '@/platform'
import type {
  Account,
  AccountBalance,
  AccountInput,
  AccountingPeriod,
  AccountTreeRow,
  ClosingPreview,
  DeterminationRule,
  DeterminationRuleInput,
  DeterminationTestResult,
  FiscalYear,
  FiscalYearInput,
  ImportResult,
  ItemResponse,
  ListResponse,
  PeriodAction,
} from './types'

type Params = Record<string, string | number | boolean | undefined>

const PER_PAGE = 100
/** 20,000 rows: a chart of accounts larger than that is not a realistic tree. */
export const MAX_PAGES = 200
export const LIMIT_EXCEEDED = 'LIMIT_EXCEEDED'

const enc = encodeURIComponent

/** Walks every page of a list endpoint; fails with LIMIT_EXCEEDED instead of truncating. */
export async function fetchAll<T>(
  path: string,
  params: Params = {},
  signal?: AbortSignal,
  maxPages = MAX_PAGES,
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; ; page += 1) {
    const res = await platform.http.get<ListResponse<T>>(path, {
      params: { ...params, page, per_page: PER_PAGE },
      signal,
    })
    rows.push(...res.data)
    const last = res.meta?.pagination?.last_page
    const done = last !== undefined ? page >= last : res.data.length < PER_PAGE
    if (done || res.data.length === 0) return rows
    if (page >= maxPages) {
      throw new ApiError(0, LIMIT_EXCEEDED, `More than ${maxPages * PER_PAGE} records.`)
    }
  }
}

const data = async <T>(p: Promise<ItemResponse<T>>): Promise<T> => (await p).data

export const accountsApi = {
  list: (query: ListQueryState, signal?: AbortSignal) =>
    platform.http.get<ListResponse<Account>>('/accounts', { params: toListParams(query), signal }),
  /** Whole chart for the tree view; nested or flat rows, see normalizeTree. */
  tree: async (signal?: AbortSignal) =>
    (await platform.http.get<ListResponse<AccountTreeRow>>('/accounts/tree', { signal })).data,
  get: (id: string, signal?: AbortSignal) =>
    data(platform.http.get<ItemResponse<Account>>(`/accounts/${enc(id)}`, { signal })),
  create: (input: AccountInput, key: string) =>
    data(platform.http.post<ItemResponse<Account>>('/accounts', input, withIdempotency({}, key))),
  update: (id: string, version: number, patch: Partial<AccountInput>) =>
    data(platform.http.patch<ItemResponse<Account>>(`/accounts/${enc(id)}`, { ...patch, version })),
  remove: async (id: string, version: number) => {
    await platform.http.delete<unknown>(`/accounts/${enc(id)}`, { params: { version } })
  },
  balance: (id: string, asOf: string, signal?: AbortSignal) =>
    data(
      platform.http.get<ItemResponse<AccountBalance>>(`/accounts/${enc(id)}/balance`, {
        params: { as_of: asOf },
        signal,
      }),
    ),
  /** Multipart upload; the same file and mode replay under one key. */
  import: (file: File, dryRun: boolean, key: string, signal?: AbortSignal) => {
    const body = new FormData()
    body.append('file', file)
    body.append('dry_run', dryRun ? '1' : '0')
    return data(
      platform.http.post<ItemResponse<ImportResult>>(
        '/accounts/import',
        body,
        withIdempotency({ signal }, key),
      ),
    )
  },
}

export const fiscalYearsApi = {
  all: (signal?: AbortSignal) =>
    fetchAll<FiscalYear>('/fiscal-years', { sort: '-start_date' }, signal),
  create: (input: FiscalYearInput, key: string) =>
    data(
      platform.http.post<ItemResponse<FiscalYear>>(
        '/fiscal-years',
        input,
        withIdempotency({}, key),
      ),
    ),
  update: (id: string, version: number, patch: Partial<FiscalYearInput>) =>
    data(
      platform.http.patch<ItemResponse<FiscalYear>>(`/fiscal-years/${enc(id)}`, {
        ...patch,
        version,
      }),
    ),
  /** Generates closing + opening entries server side, so a retry must replay, not repeat. */
  close: (year: Pick<FiscalYear, 'id' | 'version'>, key: string) =>
    data(
      platform.http.post<ItemResponse<FiscalYear>>(
        `/fiscal-years/${enc(year.id)}/close`,
        { version: year.version },
        withIdempotency({}, key),
      ),
    ),
  reopen: (year: Pick<FiscalYear, 'id' | 'version'>, reason: string, key: string) =>
    data(
      platform.http.post<ItemResponse<FiscalYear>>(
        `/fiscal-years/${enc(year.id)}/reopen`,
        { version: year.version, reason },
        withIdempotency({}, key),
      ),
    ),
  /** Read-only preview; null when this API does not offer one (404/405/501). */
  closingPreview: async (id: string, signal?: AbortSignal): Promise<ClosingPreview | null> => {
    try {
      return await data(
        platform.http.get<ItemResponse<ClosingPreview>>(`/fiscal-years/${enc(id)}/close-preview`, {
          signal,
        }),
      )
    } catch (error) {
      if (isApiError(error) && [404, 405, 501].includes(error.status)) return null
      throw error
    }
  },
}

export const periodsApi = {
  forYear: (fiscalYearId: string, signal?: AbortSignal) =>
    fetchAll<AccountingPeriod>(
      '/accounting-periods',
      { 'filter[fiscal_year_id]': fiscalYearId, sort: 'number' },
      signal,
    ),
  transition: (
    period: Pick<AccountingPeriod, 'id' | 'version'>,
    action: PeriodAction,
    reason: string | null,
  ) =>
    data(
      platform.http.post<ItemResponse<AccountingPeriod>>(
        `/accounting-periods/${enc(period.id)}/${action}`,
        reason === null ? { version: period.version } : { version: period.version, reason },
      ),
    ),
}

export const rulesApi = {
  all: (signal?: AbortSignal) =>
    fetchAll<DeterminationRule>('/account-determination-rules', { sort: '-priority' }, signal),
  create: (input: DeterminationRuleInput, key: string) =>
    data(
      platform.http.post<ItemResponse<DeterminationRule>>(
        '/account-determination-rules',
        input,
        withIdempotency({}, key),
      ),
    ),
  update: (id: string, version: number, patch: Partial<DeterminationRuleInput>) =>
    data(
      platform.http.patch<ItemResponse<DeterminationRule>>(
        `/account-determination-rules/${enc(id)}`,
        { ...patch, version },
      ),
    ),
  remove: async (id: string, version: number) => {
    await platform.http.delete<unknown>(`/account-determination-rules/${enc(id)}`, {
      params: { version },
    })
  },
  test: (eventKey: string, context: Record<string, string>) =>
    data(
      platform.http.post<ItemResponse<DeterminationTestResult>>('/account-determination/test', {
        event_key: eventKey,
        context,
      }),
    ),
}
