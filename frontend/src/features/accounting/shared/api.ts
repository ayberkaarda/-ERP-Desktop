import { toListParams, type ListQueryState } from '@/components/shared/data-table'
import { ApiError, isApiError, platform, withIdempotency } from '@/platform'
import type {
  Account,
  AccountBalance,
  AccountBalanceResponse,
  AccountInput,
  AccountingPeriod,
  AccountTreeRow,
  ClosingPreview,
  DeterminationRule,
  DeterminationRuleInput,
  DeterminationTestResponse,
  DeterminationTestResult,
  FiscalYear,
  FiscalYearInput,
  ImportResponse,
  ImportResult,
  ImportRowResult,
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

/** The API sends a signed balance (debit - credit) and balance_side; screens use amount + side. */
export function toAccountBalance(r: AccountBalanceResponse): AccountBalance {
  return {
    account_id: r.account_id,
    as_of: r.as_of ?? '',
    debit: r.debit,
    credit: r.credit,
    balance: r.balance.replace(/^-/, ''),
    side: r.balance_side,
    currency_code: r.currency_code,
    fx_balance: r.fx_balance,
  }
}

type ImportError = ImportResponse['errors'][number]

function errorRows(errors: readonly ImportError[]): ImportRowResult[] {
  const byRow = new Map<number, string[]>()
  for (const e of errors) {
    const list = byRow.get(e.row) ?? []
    list.push(e.message)
    byRow.set(e.row, list)
  }
  return [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, messages]) => ({ row, code: null, name: null, status: 'error', errors: messages }))
}

/**
 * The API reports only failed rows ({row, field, message}); every other row is a new account
 * (existing codes are errors; nothing is updated or skipped).
 */
export function toImportResult(r: ImportResponse): ImportResult {
  const rows = errorRows(r.errors)
  const failed = rows.length
  return {
    dry_run: r.dry_run,
    total: r.total,
    created: r.dry_run ? Math.max(0, r.total - failed) : r.created,
    updated: 0,
    skipped: 0,
    failed,
    rows,
  }
}

/** A real import with errors is refused (422, fields rows.<row>.<field>); read it as a report. */
export function importRefusalResult(error: unknown): ImportResult | null {
  if (!isApiError(error) || error.status !== 422) return null
  const errors: ImportError[] = []
  for (const [key, messages] of Object.entries(error.fields)) {
    const m = /^rows\.(\d+)\.(.+)$/.exec(key)
    if (!m) return null
    for (const message of messages) errors.push({ row: Number(m[1]), field: m[2] ?? '', message })
  }
  if (errors.length === 0) return null
  const rows = errorRows(errors)
  return {
    dry_run: false,
    total: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: rows.length,
    rows,
  }
}

/** Rows carry account_code/account_name when the account is loaded; screens read rule.account. */
export function withAccountRef(rule: DeterminationRule): DeterminationRule {
  if (rule.account || !rule.account_code) return rule
  return {
    ...rule,
    account: { id: rule.account_id, code: rule.account_code, name: rule.account_name ?? '' },
  }
}

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
  balance: async (id: string, asOf: string, signal?: AbortSignal) =>
    toAccountBalance(
      await data(
        platform.http.get<ItemResponse<AccountBalanceResponse>>(`/accounts/${enc(id)}/balance`, {
          params: { as_of: asOf },
          signal,
        }),
      ),
    ),
  /** Multipart upload; the same file and mode replay under one key. */
  import: async (file: File, dryRun: boolean, key: string, signal?: AbortSignal) => {
    const body = new FormData()
    body.append('file', file)
    body.append('dry_run', dryRun ? '1' : '0')
    try {
      return toImportResult(
        await data(
          platform.http.post<ItemResponse<ImportResponse>>(
            '/accounts/import',
            body,
            withIdempotency({ signal }, key),
          ),
        ),
      )
    } catch (error) {
      const refused = dryRun ? null : importRefusalResult(error)
      if (refused) return refused
      throw error
    }
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
  all: async (signal?: AbortSignal) =>
    (
      await fetchAll<DeterminationRule>(
        '/account-determination-rules',
        { sort: '-priority' },
        signal,
      )
    ).map(withAccountRef),
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
  test: async (
    eventKey: string,
    context: Record<string, string>,
  ): Promise<DeterminationTestResult> => {
    const r = await data(
      platform.http.post<ItemResponse<DeterminationTestResponse>>('/account-determination/test', {
        event_key: eventKey,
        context,
      }),
    )
    return { account_id: r.account.id, account: r.account, rule_id: r.rule_id, side: r.side }
  },
}
