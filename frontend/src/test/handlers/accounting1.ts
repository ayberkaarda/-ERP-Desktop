import { http, HttpResponse } from 'msw'
import type {
  Account,
  AccountingPeriod,
  ClosingPreview,
  DeterminationRule,
  FiscalYear,
} from '@/features/accounting/shared/types'

// In-memory stand-in for the Accounting API used by the accounts, fiscal year, period and
// account determination screens. Shapes, filters, sorts and refusals mirror
// backend/app/Modules/Accounting (controllers, requests, resources, services).

/** One failed import row as AccountImporter reports it (row = sheet row, header is row 1). */
export interface ImportErrorRow {
  row: number
  field: string
  message: string
}

export interface AccountingDb {
  accounts: Account[]
  balances: Record<
    string,
    { debit: string; credit: string; balance: string; side: 'debit' | 'credit' | null }
  >
  years: FiscalYear[]
  periods: AccountingPeriod[]
  rules: DeterminationRule[]
  /** null: an API without the closing preview (404); the screens tolerate it. */
  preview: ClosingPreview | null
  /** Drafts the server knows about but the period list does not report (race with the board). */
  hiddenDrafts: Record<string, number>
  /** Rule ids whose PATCH fails with 500 (to exercise rollback). */
  failRulePatch: Set<string>
  /** Rows the database refuses during a real (non dry-run) import (e.g. a concurrent change). */
  commitFailures: ImportErrorRow[]
  /** Years with posted entries: their dates cannot change. */
  postedYears: Set<string>
  /** Replayed responses per Idempotency-Key. */
  replays: Map<string, { status: number; body: unknown }>
  calls: { method: string; path: string; body: unknown; headers: Headers; url: URL }[]
  seq: number
}

type Row = Record<string, unknown>
const API = '*/api/v1'

function error(status: number, code: string, message: string, fields?: Record<string, string[]>) {
  return HttpResponse.json({ errors: { message, code, ...(fields ? { fields } : {}) } }, { status })
}
const validation = (fields: Record<string, string[]>) =>
  error(422, 'VALIDATION_ERROR', Object.values(fields)[0]?.[0] ?? 'Geçersiz bilgi.', fields)

/** Core ListQuery: unknown filters or sort fields are a 422 on filter.<name> / sort. */
function listGuard(url: URL, filters: readonly string[], sorts: readonly string[]) {
  for (const [key] of url.searchParams) {
    const m = /^filter\[(.+)\]$/.exec(key)
    if (m && !filters.includes(m[1] ?? ''))
      return validation({ [`filter.${m[1]}`]: ['Seçili değer geçersiz.'] })
  }
  const sort = url.searchParams.get('sort')
  if (sort) {
    for (const part of sort.split(',').filter(Boolean)) {
      if (!sorts.includes(part.replace(/^-/, '')))
        return validation({ sort: ['Geçersiz sıralama.'] })
    }
  }
  if (Number(url.searchParams.get('per_page') ?? 25) > 100)
    return validation({ per_page: ['En çok 100 olabilir.'] })
  return null
}
const notFound = () => error(404, 'NOT_FOUND', 'Kayıt bulunamadı.')
const conflict = () =>
  error(409, 'VERSION_CONFLICT', 'Kayıt siz düzenlerken başka biri tarafından değiştirildi.')

export const ACC_KASA = 'acc-100'
export const ACC_KASA_TL = 'acc-100-01'
export const ACC_BANK = 'acc-102'
export const ACC_RECEIVABLES = 'acc-120'
export const ACC_SALES = 'acc-600'
export const ACC_SALES_EXPORT = 'acc-601'
export const ACC_VAT = 'acc-391'
export const YEAR_2026 = 'fy-2026'
export const YEAR_2025 = 'fy-2025'

export function account(over: Partial<Account> & Pick<Account, 'id' | 'code' | 'name'>): Account {
  return {
    parent_id: null,
    level: 1,
    type: 'asset',
    normal_balance: 'debit',
    is_postable: true,
    is_active: true,
    is_system: false,
    tdhp_group: Number(over.code.charAt(0)) || null,
    currency_code: null,
    requires_party: false,
    requires_cost_center: false,
    requires_project: false,
    is_revaluable: false,
    notes: null,
    version: 1,
    has_postings: false,
    ...over,
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export function periodsFor(year: FiscalYear, with13 = false): AccountingPeriod[] {
  const y = Number(year.start_date.slice(0, 4))
  const out: AccountingPeriod[] = Array.from({ length: 12 }, (_, i) => ({
    id: `${year.id}-p${i + 1}`,
    fiscal_year_id: year.id,
    number: i + 1,
    start_date: `${y}-${pad(i + 1)}-01`,
    end_date: `${y}-${pad(i + 1)}-${pad(lastDay(y, i + 1))}`,
    status: 'open',
    version: 1,
    draft_count: 0,
  }))
  if (with13) {
    out.push({
      id: `${year.id}-p13`,
      fiscal_year_id: year.id,
      number: 13,
      start_date: year.end_date,
      end_date: year.end_date,
      status: 'open',
      version: 1,
      draft_count: 0,
    })
  }
  return out
}

function year(id: string, code: string, status: 'open' | 'closed' = 'open'): FiscalYear {
  return {
    id,
    code,
    name: `${code} hesap dönemi`,
    start_date: `${code}-01-01`,
    end_date: `${code}-12-31`,
    status,
    closed_at: status === 'closed' ? `${Number(code) + 1}-01-15T09:00:00Z` : null,
    closed_by: null,
    version: 1,
  }
}

export function createAccountingDb(overrides: Partial<AccountingDb> = {}): AccountingDb {
  const y2025 = year(YEAR_2025, '2025', 'closed')
  const y2026 = year(YEAR_2026, '2026')
  const accounts = [
    account({ id: ACC_KASA, code: '100', name: 'Kasa', is_postable: false, is_system: true }),
    account({
      id: ACC_KASA_TL,
      code: '100.01',
      name: 'Merkez Kasa TL',
      parent_id: ACC_KASA,
      level: 2,
      has_postings: true,
    }),
    account({ id: ACC_BANK, code: '102', name: 'Bankalar', is_postable: true }),
    account({ id: ACC_RECEIVABLES, code: '120', name: 'Alıcılar', requires_party: true }),
    account({
      id: ACC_VAT,
      code: '391',
      name: 'Hesaplanan KDV',
      type: 'liability',
      normal_balance: 'credit',
    }),
    account({
      id: ACC_SALES,
      code: '600',
      name: 'Yurt İçi Satışlar',
      type: 'revenue',
      normal_balance: 'credit',
    }),
    account({
      id: ACC_SALES_EXPORT,
      code: '601',
      name: 'Yurt Dışı Satışlar',
      type: 'revenue',
      normal_balance: 'credit',
      currency_code: 'USD',
      is_active: false,
    }),
  ]
  const periods = [
    ...periodsFor(y2025).map((p) => ({ ...p, status: 'closed' as const })),
    ...periodsFor(y2026),
  ]
  const rule = (
    id: string,
    event_key: string,
    priority: number,
    accountId: string,
    conditions: DeterminationRule['conditions'] = {},
    is_system = false,
  ): DeterminationRule => {
    const a = accounts.find((x) => x.id === accountId)
    return {
      id,
      event_key,
      priority,
      conditions,
      account_id: accountId,
      account: a ? { id: a.id, code: a.code, name: a.name } : null,
      side: null,
      description: null,
      is_system,
      version: 1,
    }
  }
  return {
    accounts,
    balances: {
      [ACC_KASA_TL]: {
        debit: '15000.0000',
        credit: '2500.5000',
        balance: '12499.5000',
        side: 'debit',
      },
    },
    years: [y2026, y2025],
    periods,
    rules: [
      rule('rule-rev-default', 'sales.revenue.goods', 0, ACC_SALES, {}, true),
      rule('rule-rev-usd', 'sales.revenue.goods', 20, ACC_SALES_EXPORT, { currency: 'USD' }),
      rule('rule-rev-eur', 'sales.revenue.goods', 10, ACC_SALES_EXPORT, {
        currency: ['EUR', 'GBP'],
      }),
      rule('rule-recv', 'sales.receivable', 0, ACC_RECEIVABLES, {}, true),
      rule('rule-vat', 'sales.vat_output', 0, ACC_VAT, {}, true),
    ],
    preview: null,
    hiddenDrafts: {},
    failRulePatch: new Set(),
    commitFailures: [],
    postedYears: new Set([YEAR_2025, YEAR_2026]),
    replays: new Map(),
    calls: [],
    seq: 1,
    ...overrides,
  }
}

function page(rows: unknown[], url: URL) {
  const perPage = Math.min(100, Number(url.searchParams.get('per_page') ?? 25))
  const current = Number(url.searchParams.get('page') ?? 1)
  const total = rows.length
  return HttpResponse.json({
    data: rows.slice((current - 1) * perPage, current * perPage),
    meta: {
      pagination: {
        current_page: current,
        per_page: perPage,
        total,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    },
  })
}

const childrenOf = (db: AccountingDb, id: string) => db.accounts.filter((a) => a.parent_id === id)

/** AccountResource: has_postings and child counts stay server side. */
function withCounts(_db: AccountingDb, a: Account): Account {
  const out = { ...a }
  delete out.has_postings
  delete out.has_children
  delete out.children_count
  return out
}

/** DeterminationRuleResource: account_code / account_name only when the account is loaded. */
function ruleResource(db: AccountingDb, r: DeterminationRule, withAccount: boolean): Row {
  const out: Row = { ...r, is_active: r.is_active ?? true }
  delete out.account
  if (withAccount) {
    const a = db.accounts.find((x) => x.id === r.account_id)
    out.account_code = a?.code
    out.account_name = a?.name
  }
  return out
}

/** Keys RuleDeterminer accepts in conditions. */
const CONDITION_KEYS = [
  'party_group',
  'party_id',
  'item_category',
  'item_id',
  'currency',
  'tax_code',
  'warehouse_id',
  'branch_id',
]

function nest(db: AccountingDb, parent: string | null): Row[] {
  return db.accounts
    .filter((a) => a.parent_id === parent)
    .map((a) => ({ ...withCounts(db, a), children: nest(db, a.id) }))
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function validateAccount(db: AccountingDb, body: Row, current: Account | null) {
  const fields: Record<string, string[]> = {}
  const code = str(body.code).trim()
  if (!code) fields.code = ['Hesap kodu zorunludur.']
  else if (db.accounts.some((a) => a.code === code && a.id !== current?.id))
    fields.code = ['Bu hesap kodu zaten kullanılıyor.']
  if (!str(body.name).trim()) fields.name = ['Hesap adı zorunludur.']
  const parentId = body.parent_id as string | null | undefined
  if (parentId) {
    const parent = db.accounts.find((a) => a.id === parentId)
    if (!parent) fields.parent_id = ['Üst hesap bulunamadı.']
    else if (parent.has_postings && parent.is_postable)
      fields.parent_id = ['Hareket görmüş hesabın altına hesap açılamaz.']
  }
  if (current && body.is_postable === true && childrenOf(db, current.id).length > 0)
    fields.is_postable = ['Alt hesabı olan hesap hareket göremez.']
  if (current?.has_postings && body.is_postable === false)
    fields.is_postable = ['Hareket görmüş hesap toplama hesabı yapılamaz.']
  if (!current && body.version !== undefined) fields.version = ['version gönderilemez.']
  if (current && body.parent_code !== undefined) fields.parent_code = ['parent_code gönderilemez.']
  return Object.keys(fields).length ? fields : null
}

/** Moves postability up the tree like the API: a parent that gets a child stops being postable. */
function demoteParent(db: AccountingDb, parentId: string | null | undefined) {
  if (!parentId) return
  const parent = db.accounts.find((a) => a.id === parentId)
  if (parent?.is_postable) {
    parent.is_postable = false
    parent.version += 1
  }
}

function replay(db: AccountingDb, request: Request) {
  const key = request.headers.get('Idempotency-Key')
  if (!key)
    return { key: null, hit: error(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key gerekli.') }
  const stored = db.replays.get(key)
  if (stored) return { key, hit: HttpResponse.json(stored.body as Row, { status: stored.status }) }
  return { key, hit: null }
}

function remember(db: AccountingDb, key: string | null, status: number, body: unknown) {
  if (key) db.replays.set(key, { status, body })
  return HttpResponse.json(body as Row, { status })
}

const BOM_START = new RegExp('^' + String.fromCharCode(0xfeff))

function parseCsv(text: string): string[][] {
  return text
    .replace(BOM_START, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => l.split(',').map((c) => c.trim()))
}

function resolve(db: AccountingDb, eventKey: string, context: Record<string, string>) {
  const candidates = db.rules
    .filter((r) => r.event_key === eventKey)
    .sort((a, b) => b.priority - a.priority)
  for (const r of candidates) {
    const conds = Object.entries(r.conditions ?? {})
    const ok = conds.every(([k, v]) => {
      const actual = context[k]
      return actual !== undefined && (Array.isArray(v) ? v.includes(actual) : v === actual)
    })
    if (ok) return { rule: r, source: conds.length ? ('rule' as const) : ('default' as const) }
  }
  return null
}

export function accountingHandlers(db: AccountingDb) {
  const log = async (request: Request) => {
    const url = new URL(request.url)
    let body: unknown = null
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      const type = request.headers.get('content-type') ?? ''
      body = type.includes('application/json') ? await request.clone().json() : 'multipart'
    }
    db.calls.push({
      method: request.method,
      path: url.pathname.replace(/^.*\/api\/v1/, ''),
      body,
      headers: request.headers,
      url,
    })
    return url
  }

  return [
    // --- accounts ---
    http.get(`${API}/accounts/tree`, async ({ request }) => {
      await log(request)
      return HttpResponse.json({ data: nest(db, null) })
    }),
    http.get(`${API}/accounts`, async ({ request }) => {
      const url = await log(request)
      const FILTERS: Record<string, keyof Account> = {
        type: 'type',
        postable: 'is_postable',
        is_postable: 'is_postable',
        active: 'is_active',
        is_active: 'is_active',
        tdhp_group: 'tdhp_group',
        level: 'level',
        currency_code: 'currency_code',
      }
      const bad = listGuard(
        url,
        [...Object.keys(FILTERS), 'parent_id'],
        ['code', 'name', 'level', 'created_at'],
      )
      if (bad) return bad
      let rows = [...db.accounts]
      // Postgres reads true/false/1/0 for boolean columns.
      const norm = (v: string) => (v === '1' ? 'true' : v === '0' ? 'false' : v)
      for (const [f, column] of Object.entries(FILTERS)) {
        const v = url.searchParams.get(`filter[${f}]`)
        if (v) rows = rows.filter((a) => v.split(',').map(norm).includes(String(a[column])))
      }
      const parent = url.searchParams.get('filter[parent_id]')
      if (parent) rows = rows.filter((a) => a.parent_id === (parent === 'root' ? null : parent))
      // ilike on code and name.
      const q = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase('tr')
      if (q)
        rows = rows.filter(
          (a) =>
            a.code.toLocaleLowerCase('tr').includes(q) ||
            a.name.toLocaleLowerCase('tr').includes(q),
        )
      const sort = url.searchParams.get('sort') ?? 'code'
      const desc = sort.startsWith('-')
      const field = (desc ? sort.slice(1) : sort) as keyof Account
      rows.sort(
        (a, b) =>
          String(a[field]).localeCompare(String(b[field]), 'tr', { numeric: true }) *
          (desc ? -1 : 1),
      )
      return page(
        rows.map((a) => withCounts(db, a)),
        url,
      )
    }),
    http.get(`${API}/accounts/:id/balance`, async ({ request, params }) => {
      const url = await log(request)
      const a = db.accounts.find((x) => x.id === params.id)
      if (!a) return notFound()
      const asOf = url.searchParams.get('as_of') ?? null
      const b = db.balances[a.id] ?? {
        debit: '0.0000',
        credit: '0.0000',
        balance: '0.0000',
        side: null,
      }
      // The API sends the signed balance (debit - credit) with balance_side.
      return HttpResponse.json({
        data: {
          account_id: a.id,
          as_of: asOf,
          debit: b.debit,
          credit: b.credit,
          balance: b.side === 'credit' ? `-${b.balance}` : b.balance,
          balance_side: b.side,
          currency_code: a.currency_code,
          fx_balance: a.currency_code ? '0.0000' : null,
        },
      })
    }),
    http.get(`${API}/accounts/:id`, async ({ request, params }) => {
      await log(request)
      const a = db.accounts.find((x) => x.id === params.id)
      return a ? HttpResponse.json({ data: withCounts(db, a) }) : notFound()
    }),
    http.post(`${API}/accounts/import`, async ({ request }) => {
      await log(request)
      const { key, hit } = replay(db, request)
      if (hit) return hit
      const form = await request.formData()
      const file = form.get('file')
      const dryRun = form.get('dry_run') === '1'
      // jsdom and the fetch runtime have different File classes; check the shape.
      if (file === null || typeof file !== 'object' || !('text' in file))
        return validation({ file: ['Dosya zorunludur.'] })
      const [header, ...lines] = parseCsv(await file.text())
      const col = (name: string) => header?.indexOf(name) ?? -1
      const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense', 'cost', 'memo']
      const errors: ImportErrorRow[] = []
      const fresh: { code: string; name: string }[] = []
      lines.forEach((cells, i) => {
        const row = i + 2
        const code = cells[col('code')] ?? ''
        const name = cells[col('name')] ?? ''
        const type = cells[col('type')] ?? ''
        const before = errors.length
        if (!code) errors.push({ row, field: 'code', message: 'Hesap kodu zorunludur.' })
        if (!name) errors.push({ row, field: 'name', message: 'Hesap adı zorunludur.' })
        if (type && !TYPES.includes(type))
          errors.push({ row, field: 'type', message: `Geçersiz hesap türü: ${type}` })
        // Existing codes are reported, never overwritten.
        if (code && db.accounts.some((a) => a.code === code))
          errors.push({ row, field: 'code', message: 'Bu hesap kodu zaten kullanılıyor.' })
        if (errors.length === before) fresh.push({ code, name })
      })
      if (!dryRun) errors.push(...db.commitFailures)
      // A real import with any error rolls back and answers 422 rows.<row>.<field>.
      if (!dryRun && errors.length > 0) {
        const fields: Record<string, string[]> = {}
        for (const e of errors) (fields[`rows.${e.row}.${e.field}`] ??= []).push(e.message)
        const body = {
          errors: {
            message: `${errors.length} satırda hata var.`,
            code: 'VALIDATION_ERROR',
            fields,
          },
        }
        return remember(db, key, 422, body)
      }
      if (!dryRun) {
        for (const r of fresh) db.accounts.push(account({ id: `acc-imp-${db.seq++}`, ...r }))
      }
      const result = {
        dry_run: dryRun,
        total: lines.length,
        created: dryRun ? 0 : fresh.length,
        errors,
      }
      return remember(db, key, 200, { data: result })
    }),
    http.post(`${API}/accounts`, async ({ request }) => {
      await log(request)
      const { key, hit } = replay(db, request)
      if (hit) return hit
      const body = (await request.json()) as Row
      const problems = validateAccount(db, body, null)
      if (problems) return validation(problems)
      const created = account({
        ...(body as unknown as Account),
        id: `acc-new-${db.seq++}`,
        level: body.parent_id ? 2 : 1,
        version: 1,
      })
      demoteParent(db, created.parent_id)
      db.accounts.push(created)
      return remember(db, key, 201, { data: withCounts(db, created) })
    }),
    http.patch(`${API}/accounts/:id`, async ({ request, params }) => {
      await log(request)
      const a = db.accounts.find((x) => x.id === params.id)
      if (!a) return notFound()
      const body = (await request.json()) as Row
      if (body.version !== a.version) return conflict()
      const problems = validateAccount(db, { ...(a as unknown as Row), ...body }, a)
      if (problems) return validation(problems)
      const rest = { ...body }
      delete rest.version
      Object.assign(a, rest, { version: a.version + 1 })
      if (rest.parent_id) demoteParent(db, rest.parent_id as string)
      return HttpResponse.json({ data: withCounts(db, a) })
    }),
    http.delete(`${API}/accounts/:id`, async ({ request, params }) => {
      const url = await log(request)
      const a = db.accounts.find((x) => x.id === params.id)
      if (!a) return notFound()
      if (Number(url.searchParams.get('version')) !== a.version) return conflict()
      if (a.is_system) return validation({ account: ['Sistem hesabı silinemez.'] })
      if (childrenOf(db, a.id).length > 0)
        return validation({ account: ['Alt hesabı olan hesap silinemez.'] })
      if (a.has_postings) return validation({ account: ['Hareket görmüş hesap silinemez.'] })
      db.accounts = db.accounts.filter((x) => x.id !== a.id)
      return new HttpResponse(null, { status: 204 })
    }),

    // --- fiscal years ---
    http.get(`${API}/fiscal-years`, async ({ request }) => {
      const url = await log(request)
      const bad = listGuard(url, ['status', 'code'], ['code', 'start_date', 'created_at'])
      if (bad) return bad
      const status = url.searchParams.get('filter[status]')
      const rows = [...db.years]
        .filter((y) => !status || y.status === status)
        .sort((a, b) => b.start_date.localeCompare(a.start_date))
        .map((y) => ({ ...y, periods: db.periods.filter((p) => p.fiscal_year_id === y.id) }))
      return page(rows, url)
    }),
    http.post(`${API}/fiscal-years`, async ({ request }) => {
      await log(request)
      const { key, hit } = replay(db, request)
      if (hit) return hit
      const body = (await request.json()) as Row
      const start = str(body.start_date)
      const end = str(body.end_date)
      if (body.version !== undefined) return validation({ version: ['version gönderilemez.'] })
      if (!str(body.code)) return validation({ code: ['Yıl kodu zorunludur.'] })
      if (db.years.some((y) => y.code === body.code))
        return validation({ code: ['Bu yıl kodu zaten var.'] })
      if (db.years.some((y) => start <= y.end_date && y.start_date <= end))
        return validation({ start_date: ['Tarih aralığı başka bir mali yılla çakışıyor.'] })
      const y: FiscalYear = {
        id: `fy-new-${db.seq++}`,
        code: str(body.code),
        name: str(body.name) || str(body.code),
        start_date: start,
        end_date: end,
        status: 'open',
        closed_at: null,
        closed_by: null,
        version: 1,
      }
      const periods = periodsFor(y, body.adjustment_period === true)
      db.years.push(y)
      db.periods.push(...periods)
      return remember(db, key, 201, { data: { ...y, periods } })
    }),
    http.patch(`${API}/fiscal-years/:id`, async ({ request, params }) => {
      await log(request)
      const y = db.years.find((x) => x.id === params.id)
      if (!y) return notFound()
      const body = (await request.json()) as Row
      if (typeof body.version !== 'number') return validation({ version: ['version zorunludur.'] })
      if (body.version !== y.version) return conflict()
      if (body.code !== undefined) return validation({ code: ['Bu alan değiştirilemez.'] })
      if (body.adjustment_period !== undefined)
        return validation({ adjustment_period: ['Bu alan değiştirilemez.'] })
      if (db.postedYears.has(y.id) && (body.start_date || body.end_date))
        return validation({ start_date: ['Kesinleşmiş fiş varken tarihler değiştirilemez.'] })
      const rest = { ...body }
      delete rest.version
      Object.assign(y, rest, { version: y.version + 1 })
      return HttpResponse.json({ data: y })
    }),
    http.get(`${API}/fiscal-years/:id/close-preview`, async ({ request, params }) => {
      await log(request)
      if (!db.years.some((y) => y.id === params.id)) return notFound()
      return db.preview ? HttpResponse.json({ data: db.preview }) : notFound()
    }),
    http.post(`${API}/fiscal-years/:id/:action`, async ({ request, params }) => {
      await log(request)
      const y = db.years.find((x) => x.id === params.id)
      if (!y) return notFound()
      const { key, hit } = replay(db, request)
      if (hit) return hit
      const body = (await request.json()) as Row
      if (body.version !== undefined && body.version !== y.version) return conflict()
      if (params.action === 'close') {
        if (y.status !== 'open') return validation({ status: ['Mali yıl zaten kapalı.'] })
        y.status = 'closed'
        y.closed_at = '2027-01-10T10:00:00Z'
      } else if (params.action === 'reopen') {
        if (!str(body.reason).trim()) return validation({ reason: ['Gerekçe zorunludur.'] })
        if (y.status === 'open') return validation({ status: ['Mali yıl kapalı değil.'] })
        y.status = 'open'
        y.closed_at = null
      } else return notFound()
      y.version += 1
      return remember(db, key, 200, { data: y })
    }),

    // --- periods ---
    http.get(`${API}/accounting-periods`, async ({ request }) => {
      const url = await log(request)
      const bad = listGuard(url, ['fiscal_year_id', 'status', 'number'], ['start_date', 'number'])
      if (bad) return bad
      const yearId = url.searchParams.get('filter[fiscal_year_id]')
      const rows = db.periods
        .filter((p) => !yearId || p.fiscal_year_id === yearId)
        .sort((a, b) => a.number - b.number)
      return page(rows, url)
    }),
    http.post(`${API}/accounting-periods/:id/:action`, async ({ request, params }) => {
      await log(request)
      const p = db.periods.find((x) => x.id === params.id)
      if (!p) return notFound()
      const body = (await request.json()) as Row
      if (body.version !== undefined && body.version !== p.version) return conflict()
      const action = String(params.action)
      const from: Record<string, string[]> = {
        'soft-close': ['open'],
        close: ['open', 'soft_closed'],
        reopen: ['soft_closed', 'closed'],
      }
      if (from[action] && !from[action].includes(p.status))
        return validation({ status: [`Dönem ${p.status} durumundan geçemez.`] })
      const drafts = (p.draft_count ?? 0) + (db.hiddenDrafts[p.id] ?? 0)
      if (action === 'close' && drafts > 0) {
        // PeriodStatusService: Messages::fail('status', 'period_has_drafts').
        return validation({ status: [`Dönemde hâlâ ${drafts} taslak yevmiye maddesi var.`] })
      }
      const next =
        action === 'soft-close'
          ? 'soft_closed'
          : action === 'close'
            ? 'closed'
            : action === 'reopen'
              ? 'open'
              : null
      if (!next) return notFound()
      if (action === 'reopen' && !str(body.reason).trim())
        return validation({ reason: ['Gerekçe zorunludur.'] })
      p.status = next
      p.version += 1
      return HttpResponse.json({ data: p })
    }),

    // --- account determination ---
    http.get(`${API}/account-determination-rules`, async ({ request }) => {
      const url = await log(request)
      const bad = listGuard(
        url,
        ['event_key', 'is_active', 'is_system', 'account_id'],
        ['event_key', 'priority', 'created_at'],
      )
      if (bad) return bad
      return page(
        [...db.rules].sort((a, b) => b.priority - a.priority).map((r) => ruleResource(db, r, true)),
        url,
      )
    }),
    http.post(`${API}/account-determination-rules`, async ({ request }) => {
      await log(request)
      const { key, hit } = replay(db, request)
      if (hit) return hit
      const body = (await request.json()) as Row
      const a = db.accounts.find((x) => x.id === body.account_id)
      if (!a) return validation({ account_id: ['Hesap bulunamadı.'] })
      if (!a.is_postable) return validation({ account_id: ['Hesap hareket görebilir olmalıdır.'] })
      const unknown = Object.keys((body.conditions as Row | undefined) ?? {}).filter(
        (k) => !CONDITION_KEYS.includes(k),
      )
      if (unknown.length)
        return validation({ conditions: [`Bilinmeyen koşul: ${unknown.join(', ')}`] })
      const created: DeterminationRule = {
        id: `rule-new-${db.seq++}`,
        event_key: str(body.event_key),
        priority: Number(body.priority),
        conditions: (body.conditions as DeterminationRule['conditions']) ?? {},
        account_id: a.id,
        side: (body.side as DeterminationRule['side']) ?? null,
        description: (body.description as string | null) ?? null,
        is_system: false,
        is_active: true,
        version: 1,
      }
      db.rules.push(created)
      // The created rule has no account loaded: no account_code / account_name.
      return remember(db, key, 201, { data: ruleResource(db, created, false) })
    }),
    http.patch(`${API}/account-determination-rules/:id`, async ({ request, params }) => {
      await log(request)
      const r = db.rules.find((x) => x.id === params.id)
      if (!r) return notFound()
      const body = (await request.json()) as Row
      if (typeof body.version !== 'number') return validation({ version: ['version zorunludur.'] })
      if (body.version !== r.version) return conflict()
      if (db.failRulePatch.has(r.id)) return error(500, 'SERVER_ERROR', 'Sunucu hatası.')
      const rest = { ...body }
      delete rest.version
      Object.assign(r, rest, { version: r.version + 1 })
      return HttpResponse.json({ data: ruleResource(db, r, false) })
    }),
    http.delete(`${API}/account-determination-rules/:id`, async ({ request, params }) => {
      const url = await log(request)
      const r = db.rules.find((x) => x.id === params.id)
      if (!r) return notFound()
      if (Number(url.searchParams.get('version')) !== r.version) return conflict()
      if (r.is_system) return validation({ rule: ['Sistem kuralı silinemez.'] })
      db.rules = db.rules.filter((x) => x.id !== r.id)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/account-determination/test`, async ({ request }) => {
      await log(request)
      const body = (await request.json()) as { event_key: string; context: Record<string, string> }
      const hit = resolve(db, body.event_key, body.context)
      if (!hit) return validation({ event_key: [`${body.event_key} için hesap belirlenemedi.`] })
      const a = db.accounts.find((x) => x.id === hit.rule.account_id)
      return HttpResponse.json({
        data: {
          event_key: body.event_key,
          account: { id: hit.rule.account_id, code: a?.code ?? '', name: a?.name ?? '' },
          side: hit.rule.side,
          rule_id: hit.rule.id,
        },
      })
    }),
  ]
}
