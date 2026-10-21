import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import type {
  AccountingPeriod,
  AccountRef,
  ApiJournalEntry,
  ApiJournalLine,
  JournalEntry,
  JournalLine,
  NamedRef,
} from '@/features/accounting/journal/types'

// In-memory stand-in for the journal entry and report endpoints, mirroring the backend
// (Accounting JournalEntryController + Resources, Reports ReportController + Resources) plus the
// read-only lookups they use (accounts, parties, cost centers, projects, periods, fiscal years).
// Entries are stored with their records on the lines for convenient fixtures; responses carry
// what the API sends (account code/name and dimension ids only).

/** AccountResource. */
export interface Account extends AccountRef {
  parent_id: string | null
  level: number
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'cost' | 'memo'
  normal_balance: 'debit' | 'credit'
  is_postable: boolean
  is_active: boolean
  is_system: boolean
  tdhp_group: number | null
  is_revaluable: boolean
  notes: string | null
  version: number
}

export interface Accounting2Db {
  accounts: Account[]
  parties: NamedRef[]
  costCenters: NamedRef[]
  projects: NamedRef[]
  periods: AccountingPeriod[]
  fiscalYears: { id: string; code: string; name: string; start_date: string; end_date: string }[]
  entries: JournalEntry[]
  /** Opening "devreden" of the journal book (entries of the fiscal year before the range). */
  bookCarriedForward: { debit: string; credit: string }
  calls: { method: string; path: string; body: unknown; headers: Headers; url: URL }[]
  idempotency: Map<string, { body: string; response: { data: ApiJournalEntry }; status: number }>
  seq: number
  numberSeq: number
}

export const ACC_CASH = 'acc-100'
export const ACC_BANKS = 'acc-102'
export const ACC_BANK_TRY = 'acc-102-01'
export const ACC_BANK_USD = 'acc-102-02'
export const ACC_RECEIVABLES = 'acc-120'
export const ACC_SALES = 'acc-600'
export const ACC_VAT = 'acc-391'
export const ACC_EXPENSES = 'acc-770'
export const PARTY_ACME = 'party-acme'
export const CC_ADMIN = 'cc-admin'
export const PERIOD_JAN = 'period-2026-01'
export const FY_2026 = 'fy-2026'
export const ENTRY_DRAFT = 'je-draft'
export const ENTRY_POSTED = 'je-posted'
export const USER_ID = 'u1'

const account = (id: string, code: string, name: string, over: Partial<Account> = {}): Account => ({
  id,
  code,
  name,
  parent_id: null,
  level: 1,
  type: 'asset',
  normal_balance: 'debit',
  currency_code: null,
  requires_party: false,
  requires_cost_center: false,
  requires_project: false,
  is_postable: true,
  is_active: true,
  is_system: false,
  tdhp_group: Number(code[0]),
  is_revaluable: false,
  notes: null,
  version: 1,
  ...over,
})

const line = (
  entryId: string,
  no: number,
  acc: Account,
  debit: string,
  credit: string,
  over: Partial<JournalLine> = {},
): JournalLine => ({
  id: `${entryId}-l${no}`,
  line_no: no,
  account_id: acc.id,
  account: acc,
  debit,
  credit,
  currency_code: null,
  fx_amount: null,
  fx_rate: null,
  party_id: null,
  party: null,
  cost_center_id: null,
  cost_center: null,
  project_id: null,
  project: null,
  description: null,
  due_date: null,
  document_ref: null,
  ...over,
})

export function createAccounting2Db(overrides: Partial<Accounting2Db> = {}): Accounting2Db {
  const cash = account(ACC_CASH, '100', 'Kasa')
  const banks = account(ACC_BANKS, '102', 'Bankalar', { is_postable: false })
  const bankTry = account(ACC_BANK_TRY, '102.01', 'Akbank TL', { parent_id: ACC_BANKS, level: 2 })
  const bankUsd = account(ACC_BANK_USD, '102.02', 'Garanti USD', {
    parent_id: ACC_BANKS,
    level: 2,
    currency_code: 'USD',
    is_revaluable: true,
  })
  const receivables = account(ACC_RECEIVABLES, '120', 'Alıcılar', { requires_party: true })
  const sales = account(ACC_SALES, '600', 'Yurt İçi Satışlar', {
    type: 'revenue',
    normal_balance: 'credit',
  })
  const vat = account(ACC_VAT, '391', 'Hesaplanan KDV', {
    type: 'liability',
    normal_balance: 'credit',
  })
  const expenses = account(ACC_EXPENSES, '770', 'Genel Yönetim Giderleri', {
    type: 'expense',
    requires_cost_center: true,
  })
  const acme = { id: PARTY_ACME, code: 'P000001', name: 'Acme Ticaret A.Ş.' }
  return {
    accounts: [cash, banks, bankTry, bankUsd, receivables, sales, vat, expenses],
    parties: [acme, { id: 'party-beta', code: 'P000002', name: 'Beta Lojistik Ltd.' }],
    costCenters: [{ id: CC_ADMIN, code: 'GY', name: 'Genel yönetim' }],
    projects: [{ id: 'prj-1', code: 'PRJ1', name: 'Fabrika genişletme' }],
    fiscalYears: [
      { id: FY_2026, code: '2026', name: '2026', start_date: '2026-01-01', end_date: '2026-12-31' },
    ],
    periods: [
      {
        id: PERIOD_JAN,
        fiscal_year_id: FY_2026,
        number: 1,
        is_adjustment: false,
        start_date: '2026-01-01',
        end_date: '2026-01-31',
        status: 'open',
      },
    ],
    entries: [
      {
        id: ENTRY_DRAFT,
        number: null,
        entry_type: 'general',
        entry_date: '2026-01-20',
        period_id: PERIOD_JAN,
        description: 'Kira tahakkuku',
        status: 'draft',
        source_type: null,
        source_id: null,
        reverses_id: null,
        reversed_by_id: null,
        total_debit: '1000.0000',
        total_credit: '1000.0000',
        posted_at: null,
        created_by: USER_ID,
        created_at: '2026-01-20T09:00:00Z',
        version: 3,
        lines: [
          line(ENTRY_DRAFT, 1, expenses, '1000.0000', '0.0000', {
            cost_center_id: CC_ADMIN,
            cost_center: { id: CC_ADMIN, code: 'GY', name: 'Genel yönetim' },
          }),
          line(ENTRY_DRAFT, 2, cash, '0.0000', '1000.0000'),
        ],
      },
      {
        id: ENTRY_POSTED,
        number: '2026/000001',
        entry_type: 'general',
        entry_date: '2026-01-10',
        period_id: PERIOD_JAN,
        description: 'Peşin satış',
        status: 'posted',
        source_type: null,
        source_id: null,
        reverses_id: null,
        reversed_by_id: null,
        total_debit: '1200.0000',
        total_credit: '1200.0000',
        posted_at: '2026-01-10T12:00:00Z',
        posted_by: USER_ID,
        created_by: USER_ID,
        created_at: '2026-01-10T11:00:00Z',
        version: 2,
        lines: [
          line(ENTRY_POSTED, 1, cash, '1200.0000', '0.0000'),
          line(ENTRY_POSTED, 2, sales, '0.0000', '1000.0000'),
          line(ENTRY_POSTED, 3, vat, '0.0000', '200.0000'),
        ],
      },
    ],
    bookCarriedForward: { debit: '0.0000', credit: '0.0000' },
    calls: [],
    idempotency: new Map(),
    seq: 0,
    numberSeq: 1,
    ...overrides,
  }
}

type Row = Record<string, unknown>
const API = '*/api/v1'
const D = (v: unknown) =>
  new Decimal(typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v) ? v : '0')
const f4 = (d: Decimal) => d.toFixed(4)
const ZERO = new Decimal(0)

/** Core error envelope: { errors: { message, code, fields? } }. */
function error(status: number, code: string, message: string, fields?: Record<string, string[]>) {
  return HttpResponse.json({ errors: { message, code, ...(fields ? { fields } : {}) } }, { status })
}
const validation = (fields: Record<string, string[]>) =>
  error(422, 'VALIDATION_ERROR', Object.values(fields)[0]?.[0] ?? 'Geçersiz.', fields)
const notFound = () => error(404, 'NOT_FOUND', 'Kayıt bulunamadı.')
const conflict = () =>
  error(409, 'VERSION_CONFLICT', 'Kayıt siz düzenlerken başka biri tarafından değiştirildi.')

function paginate<T>(rows: T[], url: URL, maxPerPage = 100, defaultPerPage = 25) {
  const perPage = Math.min(maxPerPage, Number(url.searchParams.get('per_page') ?? defaultPerPage))
  const page = Number(url.searchParams.get('page') ?? 1)
  const total = rows.length
  return {
    data: rows.slice((page - 1) * perPage, page * perPage),
    meta: {
      pagination: {
        total,
        current_page: page,
        per_page: perPage,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    },
  }
}

const searchIn = (q: string, ...values: (string | null | undefined)[]) => {
  const needle = q.trim().toLocaleLowerCase('tr')
  return !needle || values.some((v) => v?.toLocaleLowerCase('tr').includes(needle))
}

const truthy = (v: string | null) => v === '1' || v === 'true'

/** Accounts at and under `id` (a report on a parent covers its sub-accounts). */
function subtree(db: Accounting2Db, id: string): Set<string> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const a of db.accounts) {
      if (a.parent_id && out.has(a.parent_id) && !out.has(a.id)) {
        out.add(a.id)
        grew = true
      }
    }
  }
  return out
}

/** ReportRequest: period_id, or both dates (inclusive), never both. */
function range(
  db: Accounting2Db,
  url: URL,
): { from: string; to: string; periodId: string | null } | Response {
  const param = (k: string) => {
    const v = url.searchParams.get(k)
    return v === '' ? null : v
  }
  const periodId = param('period_id')
  const from = param('date_from')
  const to = param('date_to')
  if (periodId && (from || to))
    return validation({ period_id: ['Dönem ile tarih aralığı birlikte verilemez.'] })
  if (periodId) {
    const period = db.periods.find((p) => p.id === periodId)
    if (!period) return validation({ period_id: ['Dönem bulunamadı.'] })
    return { from: period.start_date, to: period.end_date, periodId }
  }
  const fields: Record<string, string[]> = {}
  if (!from) fields.date_from = ['Başlangıç tarihi zorunlu.']
  if (!to) fields.date_to = ['Bitiş tarihi zorunlu.']
  if (from && to && to < from) fields.date_to = ['Bitiş başlangıçtan önce olamaz.']
  if (Object.keys(fields).length) return validation(fields)
  return { from: from ?? '', to: to ?? '', periodId: null }
}

/** Booked entries: posted ones, and reversed ones together with their reversal. */
const booked = (db: Accounting2Db) => db.entries.filter((e) => e.status !== 'draft')

const accountOf = (db: Accounting2Db, l: JournalLine) =>
  db.accounts.find((a) => a.id === l.account_id) ?? l.account ?? null

/** JournalLineResource. */
function apiLine(db: Accounting2Db, l: JournalLine): ApiJournalLine {
  const acc = accountOf(db, l)
  return {
    id: l.id,
    line_no: l.line_no,
    account_id: l.account_id,
    account_code: acc?.code ?? '',
    account_name: acc?.name ?? '',
    debit: l.debit,
    credit: l.credit,
    currency_code: l.currency_code,
    fx_amount: l.fx_amount,
    fx_rate: l.fx_rate,
    party_id: l.party_id,
    cost_center_id: l.cost_center_id,
    project_id: l.project_id,
    description: l.description,
    due_date: l.due_date,
    document_ref: l.document_ref,
  }
}

/** The stored entry without its client-side records and lines. */
function entryFields(
  e: JournalEntry,
): Omit<JournalEntry, 'lines' | 'reverses' | 'reversed_by' | 'audit'> {
  const out: Partial<JournalEntry> = { ...e }
  delete out.lines
  delete out.reverses
  delete out.reversed_by
  delete out.audit
  return out as Omit<JournalEntry, 'lines' | 'reverses' | 'reversed_by' | 'audit'>
}

/** JournalEntryResource (with lines); the stored audit is the client shape, not sent. */
function apiEntry(db: Accounting2Db, e: JournalEntry): ApiJournalEntry {
  const rest = entryFields(e)
  return {
    ...rest,
    fiscal_year_id: rest.fiscal_year_id ?? FY_2026,
    reversal_reason: rest.reversal_reason ?? null,
    difference: f4(D(e.total_debit).minus(D(e.total_credit))),
    created_by: rest.created_by ?? null,
    posted_by: rest.posted_by ?? null,
    lines: e.lines.map((l) => apiLine(db, l)),
  }
}

function summary(e: JournalEntry) {
  const rest = entryFields(e)
  return {
    ...rest,
    fiscal_year_id: rest.fiscal_year_id ?? FY_2026,
    reversal_reason: rest.reversal_reason ?? null,
    difference: f4(D(e.total_debit).minus(D(e.total_credit))),
    line_count: e.lines.length,
  }
}

/** The show endpoint's activity rows (event, description, causer_id, created_at). */
function auditRows(e: JournalEntry) {
  const rows = []
  if (e.posted_at)
    rows.push({
      event: 'updated',
      description: 'updated',
      causer_id: e.posted_by ?? null,
      created_at: e.posted_at,
    })
  if (e.created_at)
    rows.push({
      event: 'created',
      description: 'created',
      causer_id: e.created_by ?? null,
      created_at: e.created_at,
    })
  return rows
}

interface LineBody {
  account_id?: string
  debit?: string
  credit?: string
  currency_code?: string | null
  fx_amount?: string | null
  fx_rate?: string | null
  party_id?: string | null
  cost_center_id?: string | null
  project_id?: string | null
  description?: string | null
  document_ref?: string | null
}

const MONEY = /^\d{1,16}(\.\d{1,4})?$/
const MANUAL = ['opening', 'general', 'receipt', 'payment', 'adjustment']

/** JournalEntryRequest: shape only; balance and dimension rules are checked when posting. */
function validateDraft(db: Accounting2Db, body: Row, creating: boolean): Record<string, string[]> {
  const fields: Record<string, string[]> = {}
  const lines = Array.isArray(body.lines) ? (body.lines as LineBody[]) : []
  if (creating && body.version !== undefined) fields.version = ['Sürüm gönderilemez.']
  if (!creating && typeof body.version !== 'number') fields.version = ['Sürüm zorunlu.']
  if (typeof body.entry_type !== 'string' || !MANUAL.includes(body.entry_type))
    fields.entry_type = ['Fiş türü geçersiz.']
  if (typeof body.entry_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.entry_date))
    fields.entry_date = ['Tarih geçersiz.']
  if (lines.length === 0) fields.lines = ['En az bir satır gerekli.']
  if (lines.length > 500) fields.lines = ['En çok 500 satır olabilir.']
  lines.forEach((l, i) => {
    if (!db.accounts.some((a) => a.id === l.account_id))
      fields[`lines.${i}.account_id`] = ['Hesap bulunamadı.']
    for (const side of ['debit', 'credit'] as const) {
      const v = l[side]
      if (v !== undefined && (typeof v !== 'string' || !MONEY.test(v)))
        fields[`lines.${i}.${side}`] = ['Tutar geçersiz.']
    }
    if (l.fx_rate && !/^\d{1,14}(\.\d{1,6})?$/.test(l.fx_rate))
      fields[`lines.${i}.fx_rate`] = ['Kur geçersiz.']
  })
  return fields
}

/** LineBuilder::assertBookable (strict), run by POST /journal-entries/{id}/post. */
function bookableErrors(db: Accounting2Db, e: JournalEntry): Record<string, string[]> {
  const fields: Record<string, string[]> = {}
  e.lines.forEach((l, i) => {
    const acc = accountOf(db, l)
    if (!acc?.is_postable) fields[`lines.${i}.account_id`] = ['Hesap kayıt kabul etmiyor.']
    const d = D(l.debit)
    const c = D(l.credit)
    if ((d.gt(0) && c.gt(0)) || d.plus(c).isZero())
      fields[`lines.${i}.debit`] = ['Borç ya da alacaktan yalnız biri dolu olmalı.']
    if (acc?.requires_party && !l.party_id)
      fields[`lines.${i}.party_id`] = [`${acc.code} hesabı bu boyutu zorunlu tutar.`]
    if (acc?.requires_cost_center && !l.cost_center_id)
      fields[`lines.${i}.cost_center_id`] = [`${acc.code} hesabı bu boyutu zorunlu tutar.`]
    if (acc?.requires_project && !l.project_id)
      fields[`lines.${i}.project_id`] = [`${acc.code} hesabı bu boyutu zorunlu tutar.`]
    if (acc?.currency_code && (!l.fx_amount || !l.fx_rate))
      fields[`lines.${i}.fx_amount`] = ['Döviz tutarı ve kur zorunlu.']
  })
  if (!D(e.total_debit).eq(D(e.total_credit)))
    fields.lines = [`Borç (${e.total_debit}) ve alacak (${e.total_credit}) toplamları farklı.`]
  return fields
}

function buildLines(db: Accounting2Db, entryId: string, lines: LineBody[]): JournalLine[] {
  return lines.map((l, i) => ({
    id: `${entryId}-l${i + 1}`,
    line_no: i + 1,
    account_id: l.account_id ?? '',
    account: db.accounts.find((a) => a.id === l.account_id) ?? null,
    debit: f4(D(l.debit)),
    credit: f4(D(l.credit)),
    currency_code: l.currency_code ?? null,
    fx_amount: l.fx_amount ?? null,
    fx_rate: l.fx_rate ?? null,
    party_id: l.party_id ?? null,
    cost_center_id: l.cost_center_id ?? null,
    project_id: l.project_id ?? null,
    description: l.description ?? null,
    due_date: null,
    document_ref: l.document_ref ?? null,
  }))
}

function totals(lines: JournalLine[]) {
  return {
    total_debit: f4(lines.reduce((s, l) => s.plus(D(l.debit)), ZERO)),
    total_credit: f4(lines.reduce((s, l) => s.plus(D(l.credit)), ZERO)),
  }
}

function nextNumber(db: Accounting2Db, date: string) {
  const n = db.numberSeq
  db.numberSeq += 1
  // numberSeq starts after the seeded posted entry.
  return `${date.slice(0, 4)}/${String(n + 1).padStart(6, '0')}`
}

/** XLSX files are zip archives: these bytes are not valid UTF-8 and break a text round trip. */
export const XLSX_BYTES = [0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x80, 0xc3]

/** Export body as the backend sends it: CSV text (default) or binary XLSX, with a file name. */
function exported(url: URL, name: string, rows: string[][]) {
  const format = url.searchParams.get('format') ?? 'csv'
  if (!['csv', 'xlsx'].includes(format)) return validation({ format: ['Geçersiz biçim.'] })
  if (format === 'xlsx') {
    return new HttpResponse(new Uint8Array(XLSX_BYTES), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${name}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}.xlsx`,
      },
    })
  }
  return new HttpResponse(rows.map((r) => r.join(',')).join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=UTF-8',
      'Content-Disposition': `attachment; filename="${name}.csv"`,
    },
  })
}

interface Sums {
  d: Decimal
  c: Decimal
}

const TDHP_GROUPS: Record<number, string> = {
  1: 'Dönen Varlıklar',
  2: 'Duran Varlıklar',
  3: 'Kısa Vadeli Yabancı Kaynaklar',
  4: 'Uzun Vadeli Yabancı Kaynaklar',
  5: 'Öz Kaynaklar',
  6: 'Gelir Tablosu Hesapları',
  7: 'Maliyet Hesapları',
  8: 'Serbest',
  9: 'Nazım Hesaplar',
}

/** Amounts::toArray of opening and movement sums. */
function amounts(o: Sums, m: Sums, balances?: { d: Decimal; c: Decimal }) {
  const td = o.d.plus(m.d)
  const tc = o.c.plus(m.c)
  const bal = td.minus(tc)
  return {
    opening_debit: f4(o.d),
    opening_credit: f4(o.c),
    debit: f4(m.d),
    credit: f4(m.c),
    total_debit: f4(td),
    total_credit: f4(tc),
    balance_debit: f4(balances ? balances.d : bal.gt(0) ? bal : ZERO),
    balance_credit: f4(balances ? balances.c : bal.lt(0) ? bal.abs() : ZERO),
  }
}

export function accounting2Handlers(db: Accounting2Db) {
  const record = http.all(`${API}/*`, async ({ request }) => {
    const url = new URL(request.url)
    let body: unknown = null
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      body = await request
        .clone()
        .json()
        .catch(() => null)
    }
    db.calls.push({
      method: request.method,
      path: url.pathname.replace(/^.*\/api\/v1/, ''),
      body,
      headers: request.headers,
      url,
    })
    return undefined
  })

  const find = (id: string) => db.entries.find((e) => e.id === id)

  /** Sums of booked lines per account, rolled up to every ancestor, in [lo, hi]. */
  const sums = (lo: string, hi: string) => {
    const m = new Map<string, Sums>()
    for (const e of booked(db)) {
      if (e.entry_date < lo || e.entry_date > hi) continue
      for (const l of e.lines) {
        let acc: Account | undefined = db.accounts.find((a) => a.id === l.account_id)
        while (acc) {
          const cur = m.get(acc.id) ?? { d: ZERO, c: ZERO }
          m.set(acc.id, { d: cur.d.plus(D(l.debit)), c: cur.c.plus(D(l.credit)) })
          const parent: string | null = acc.parent_id
          acc = parent ? db.accounts.find((a) => a.id === parent) : undefined
        }
      }
    }
    return m
  }

  return [
    record,
    // ---- lookups ------------------------------------------------------------------------
    http.get(`${API}/accounts`, ({ request }) => {
      const url = new URL(request.url)
      const p = (k: string) => url.searchParams.get(`filter[${k}]`)
      const q = url.searchParams.get('q') ?? ''
      let rows = db.accounts.filter((a) => searchIn(q, a.code, a.name))
      const postable = p('postable') ?? p('is_postable')
      const active = p('active') ?? p('is_active')
      if (postable !== null) rows = rows.filter((a) => a.is_postable === truthy(postable))
      if (active !== null) rows = rows.filter((a) => a.is_active === truthy(active))
      rows = [...rows].sort((a, b) => a.code.localeCompare(b.code))
      return HttpResponse.json(paginate(rows, url))
    }),
    http.get(`${API}/accounts/:id`, ({ params }) => {
      const row = db.accounts.find((a) => a.id === String(params.id))
      return row ? HttpResponse.json({ data: row }) : notFound()
    }),
    ...(
      [
        ['parties', () => db.parties],
        ['cost-centers', () => db.costCenters],
        ['projects', () => db.projects],
      ] as const
    ).flatMap(([path, rows]) => [
      http.get(`${API}/${path}`, ({ request }) => {
        const url = new URL(request.url)
        const q = url.searchParams.get('q') ?? ''
        return HttpResponse.json(
          paginate(
            rows().filter((r) => searchIn(q, r.code, r.name)),
            url,
          ),
        )
      }),
      http.get(`${API}/${path}/:id`, ({ params }) => {
        const row = rows().find((r) => r.id === String(params.id))
        return row ? HttpResponse.json({ data: row }) : notFound()
      }),
    ]),
    http.get(`${API}/accounting-periods`, ({ request }) => {
      const url = new URL(request.url)
      const sort = url.searchParams.get('sort')
      if (sort && !['start_date', 'number', '-start_date', '-number'].includes(sort))
        return validation({ sort: ['Geçersiz sıralama.'] })
      return HttpResponse.json(paginate(db.periods, url))
    }),
    http.get(`${API}/fiscal-years`, ({ request }) =>
      HttpResponse.json(paginate(db.fiscalYears, new URL(request.url))),
    ),

    // ---- journal entries ----------------------------------------------------------------
    http.get(`${API}/journal-entries/export`, ({ request }) => {
      const url = new URL(request.url)
      return exported(url, 'journal-20260121-100000', [
        ['number', 'entry_date', 'total_debit'],
        ...db.entries.map((e) => [e.number ?? '', e.entry_date, e.total_debit]),
      ])
    }),
    http.get(`${API}/journal-entries`, ({ request }) => {
      const url = new URL(request.url)
      const p = (k: string) => url.searchParams.get(`filter[${k}]`) ?? ''
      const allowed = [
        'entry_type',
        'status',
        'period_id',
        'fiscal_year_id',
        'source_type',
        'date_from',
        'date_to',
        'account_id',
        'party_id',
        'amount_min',
        'amount_max',
      ]
      for (const key of url.searchParams.keys()) {
        const m = /^filter\[(.+)\]$/.exec(key)
        if (m?.[1] && !allowed.includes(m[1]))
          return validation({ filter: [`Filtre desteklenmiyor: ${m[1]}`] })
      }
      for (const k of ['amount_min', 'amount_max'])
        if (p(k) && !MONEY.test(p(k))) return validation({ [`filter.${k}`]: ['Tutar geçersiz.'] })
      const q = url.searchParams.get('q') ?? ''
      let rows = db.entries.filter((e) => searchIn(q, e.number, e.description))
      if (p('date_from')) rows = rows.filter((e) => e.entry_date >= p('date_from'))
      if (p('date_to')) rows = rows.filter((e) => e.entry_date <= p('date_to'))
      if (p('entry_type'))
        rows = rows.filter((e) => p('entry_type').split(',').includes(e.entry_type))
      if (p('status')) rows = rows.filter((e) => p('status').split(',').includes(e.status))
      // The backend matches the exact account on a line (no sub-accounts).
      if (p('account_id'))
        rows = rows.filter((e) => e.lines.some((l) => l.account_id === p('account_id')))
      if (p('party_id'))
        rows = rows.filter((e) => e.lines.some((l) => l.party_id === p('party_id')))
      if (p('amount_min')) rows = rows.filter((e) => D(e.total_debit).gte(p('amount_min')))
      if (p('amount_max')) rows = rows.filter((e) => D(e.total_debit).lte(p('amount_max')))
      const sort = url.searchParams.get('sort') ?? '-entry_date'
      const desc = sort.startsWith('-')
      const key = (desc ? sort.slice(1) : sort) as 'entry_date' | 'number' | 'total_debit'
      if (!['entry_date', 'number', 'created_at', 'posted_at', 'total_debit'].includes(key))
        return validation({ sort: ['Geçersiz sıralama.'] })
      rows = [...rows].sort((a, b) => {
        const av = a[key] ?? ''
        const bv = b[key] ?? ''
        return desc ? bv.localeCompare(av) : av.localeCompare(bv)
      })
      return HttpResponse.json(paginate(rows.map(summary), url))
    }),
    http.get(`${API}/journal-entries/:id`, ({ params }) => {
      const row = find(String(params.id))
      return row
        ? HttpResponse.json({ data: { ...apiEntry(db, row), audit: auditRows(row) } })
        : notFound()
    }),
    http.post(`${API}/journal-entries`, async ({ request }) => {
      const key = request.headers.get('Idempotency-Key')
      if (!key) return error(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key gerekli.')
      const raw = await request.text()
      const seen = db.idempotency.get(key)
      if (seen) {
        if (seen.body !== raw)
          return error(422, 'IDEMPOTENCY_KEY_REUSED', 'Anahtar başka bir istekte kullanıldı.')
        return HttpResponse.json(seen.response, { status: seen.status })
      }
      const body = JSON.parse(raw) as Row
      const problems = validateDraft(db, body, true)
      if (Object.keys(problems).length) return validation(problems)
      db.seq += 1
      const id = `je-new-${db.seq}`
      const lines = buildLines(db, id, body.lines as LineBody[])
      const entry: JournalEntry = {
        id,
        number: null,
        entry_type: body.entry_type as JournalEntry['entry_type'],
        entry_date: body.entry_date as string,
        period_id: PERIOD_JAN,
        fiscal_year_id: FY_2026,
        description: (body.description as string | null) ?? null,
        status: 'draft',
        source_type: null,
        source_id: null,
        reverses_id: null,
        reversed_by_id: null,
        posted_at: null,
        created_by: USER_ID,
        created_at: '2026-01-21T10:00:00Z',
        version: 1,
        lines,
        ...totals(lines),
      }
      db.entries.push(entry)
      const response = { data: apiEntry(db, entry) }
      db.idempotency.set(key, { body: raw, response, status: 201 })
      return HttpResponse.json(response, { status: 201 })
    }),
    http.patch(`${API}/journal-entries/:id`, async ({ params, request }) => {
      const entry = find(String(params.id))
      if (!entry) return notFound()
      const body = (await request.json()) as Row
      const problems = validateDraft(db, body, false)
      if (problems.version) return validation({ version: problems.version })
      if (body.version !== entry.version) return conflict()
      if (entry.status !== 'draft')
        return validation({ entry: ['Yalnız taslak fiş değiştirilebilir.'] })
      if (Object.keys(problems).length) return validation(problems)
      const lines = buildLines(db, entry.id, body.lines as LineBody[])
      Object.assign(entry, {
        entry_type: body.entry_type,
        entry_date: body.entry_date,
        description: body.description ?? null,
        lines,
        version: entry.version + 1,
        ...totals(lines),
      })
      return HttpResponse.json({ data: apiEntry(db, entry) })
    }),
    http.delete(`${API}/journal-entries/:id`, ({ params, request }) => {
      const entry = find(String(params.id))
      if (!entry) return notFound()
      const version = new URL(request.url).searchParams.get('version')
      if (version !== null && Number(version) !== entry.version) return conflict()
      if (entry.status !== 'draft') return validation({ entry: ['Yalnız taslak fiş silinebilir.'] })
      db.entries = db.entries.filter((e) => e !== entry)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/journal-entries/:id/post`, async ({ params, request }) => {
      if (!request.headers.get('Idempotency-Key'))
        return error(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key gerekli.')
      const entry = find(String(params.id))
      if (!entry) return notFound()
      const body = ((await request.json().catch(() => ({}))) ?? {}) as Row
      if (body.version !== undefined && body.version !== entry.version) return conflict()
      if (entry.status !== 'draft') return validation({ entry: ['Fiş taslak değil.'] })
      const problems = bookableErrors(db, entry)
      if (Object.keys(problems).length) return validation(problems)
      Object.assign(entry, {
        status: 'posted',
        number: nextNumber(db, entry.entry_date),
        posted_at: '2026-01-21T10:05:00Z',
        posted_by: USER_ID,
        version: entry.version + 1,
      })
      return HttpResponse.json({ data: apiEntry(db, entry) })
    }),
    http.post(`${API}/journal-entries/:id/reverse`, async ({ params, request }) => {
      if (!request.headers.get('Idempotency-Key'))
        return error(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key gerekli.')
      const entry = find(String(params.id))
      if (!entry) return notFound()
      const body = (await request.json()) as Row
      const fields: Record<string, string[]> = {}
      if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date))
        fields.date = ['Tarih geçersiz.']
      if (typeof body.reason !== 'string' || body.reason.trim() === '')
        fields.reason = ['Gerekçe zorunlu.']
      else if (body.reason.length > 1000) fields.reason = ['Gerekçe çok uzun.']
      if (Object.keys(fields).length) return validation(fields)
      if (body.version !== undefined && body.version !== entry.version) return conflict()
      if (entry.status !== 'posted')
        return validation({ entry: ['Yalnız kesinleşmiş fiş ters kaydedilebilir.'] })
      if ((body.date as string) < entry.entry_date)
        return validation({ date: ['Ters kayıt tarihi asıl fişten önce olamaz.'] })
      db.seq += 1
      const id = `je-rev-${db.seq}`
      const lines = entry.lines.map((l) => ({
        ...l,
        id: `${id}-l${l.line_no}`,
        debit: l.credit,
        credit: l.debit,
      }))
      const reversal: JournalEntry = {
        ...entry,
        id,
        number: nextNumber(db, body.date as string),
        entry_type: 'reversal',
        entry_date: body.date as string,
        description: `Ters kayıt: ${entry.number ?? ''}`,
        status: 'posted',
        reverses_id: entry.id,
        reversed_by_id: null,
        reversal_reason: body.reason as string,
        posted_by: USER_ID,
        version: 1,
        lines,
        ...totals(lines),
      }
      Object.assign(entry, {
        status: 'reversed',
        reversed_by_id: id,
        reversal_reason: body.reason,
        version: entry.version + 1,
      })
      db.entries.push(reversal)
      return HttpResponse.json({ data: apiEntry(db, reversal) }, { status: 201 })
    }),

    // ---- reports ------------------------------------------------------------------------
    http.get(`${API}/reports/:report/export`, ({ request, params }) => {
      const url = new URL(request.url)
      const r = range(db, url)
      if (r instanceof Response) return r
      return exported(url, `${String(params.report)}-20260121-100000`, [['report'], [url.pathname]])
    }),
    http.get(`${API}/reports/trial-balance`, ({ request }) => {
      const url = new URL(request.url)
      const r = range(db, url)
      if (r instanceof Response) return r
      const { from, to } = r
      const levelParam = url.searchParams.get('level')
      const level = levelParam ? Number(levelParam) : Infinity
      const includeZero = truthy(url.searchParams.get('include_zero'))
      const compare = truthy(url.searchParams.get('compare_with_previous_year'))
      const yearStart = `${from.slice(0, 4)}-01-01`
      const shift = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`
      const zero: Sums = { d: ZERO, c: ZERO }
      const none = new Map<string, Sums>()
      const openingMap = from > yearStart ? sums(yearStart, prevDay(from)) : none
      const moveMap = sums(from, to)
      const prevOpening =
        compare && from > yearStart ? sums(shift(yearStart), prevDay(shift(from))) : none
      const prevMove = compare ? sums(shift(from), shift(to)) : none
      const allRows = db.accounts
        .filter((a) => a.level <= level)
        .map((a) => {
          const o = openingMap.get(a.id) ?? zero
          const m = moveMap.get(a.id) ?? zero
          return {
            account_id: a.id,
            code: a.code,
            name: a.name,
            level: a.level,
            parent_id: a.parent_id,
            tdhp_group: a.tdhp_group,
            type: a.type,
            normal_balance: a.normal_balance,
            is_postable: a.is_postable,
            is_active: a.is_active,
            ...amounts(o, m),
            previous: compare
              ? amounts(prevOpening.get(a.id) ?? zero, prevMove.get(a.id) ?? zero)
              : null,
          }
        })
        .sort((a, b) => a.code.localeCompare(b.code))
      const rows = allRows.filter(
        (row) =>
          includeZero ||
          !(
            D(row.debit).isZero() &&
            D(row.credit).isZero() &&
            D(row.opening_debit).isZero() &&
            D(row.opening_credit).isZero()
          ),
      )
      // Totals over top-level accounts (each booking counted once); balance columns are the sums
      // of the accounts' debit and credit balances.
      type TbRow = (typeof allRows)[number]
      const total = (list: TbRow[], pick: (r: TbRow) => ReturnType<typeof amounts> | null) => {
        const s = (k: keyof ReturnType<typeof amounts>) =>
          list.reduce((acc, r) => acc.plus(D(pick(r)?.[k])), ZERO)
        return amounts(
          { d: s('opening_debit'), c: s('opening_credit') },
          { d: s('debit'), c: s('credit') },
          { d: s('balance_debit'), c: s('balance_credit') },
        )
      }
      const roots = allRows.filter((row) => !row.parent_id)
      const t = total(roots, (row) => row)
      const groups = [...new Set(roots.map((row) => row.tdhp_group ?? 0))]
        .sort((a, b) => a - b)
        .map((g) => {
          const members = roots.filter((row) => (row.tdhp_group ?? 0) === g)
          return {
            tdhp_group: g,
            name: TDHP_GROUPS[g] ?? String(g),
            ...total(members, (row) => row),
            previous: compare ? total(members, (row) => row.previous) : null,
          }
        })
        .filter((g) => includeZero || !D(g.total_debit).plus(D(g.total_credit)).isZero())
      return HttpResponse.json({
        data: {
          date_from: from,
          date_to: to,
          period_id: r.periodId,
          source: r.periodId ? 'balances' : 'lines',
          level: Number.isFinite(level) ? level : null,
          include_zero: includeZero,
          compare_with_previous_year: compare,
          previous_range: compare
            ? { date_from: shift(from), date_to: shift(to), period_id: null, source: 'lines' }
            : null,
          rows,
          groups,
          totals: t,
          previous_totals: compare ? total(roots, (row) => row.previous) : null,
          balanced: D(t.total_debit).eq(D(t.total_credit)),
          difference: f4(D(t.total_debit).minus(D(t.total_credit))),
        },
      })
    }),
    http.get(`${API}/reports/general-ledger`, ({ request }) => {
      const url = new URL(request.url)
      const r = range(db, url)
      if (r instanceof Response) return r
      const accountId = url.searchParams.get('account_id') ?? ''
      if (!accountId) return validation({ account_id: ['Hesap zorunlu.'] })
      const acc = db.accounts.find((a) => a.id === accountId)
      if (!acc) return notFound()
      const ids = subtree(db, accountId)
      const { from, to } = r
      let opening = ZERO
      const movements: { e: JournalEntry; l: JournalLine }[] = []
      for (const e of [...booked(db)].sort((a, b) =>
        a.entry_date === b.entry_date
          ? String(a.number).localeCompare(String(b.number))
          : a.entry_date.localeCompare(b.entry_date),
      )) {
        for (const l of e.lines) {
          if (!ids.has(l.account_id)) continue
          if (e.entry_date < from) opening = opening.plus(D(l.debit)).minus(D(l.credit))
          else if (e.entry_date <= to) movements.push({ e, l })
        }
      }
      let running = opening
      let td = ZERO
      let tc = ZERO
      const rows = movements.map(({ e, l }) => {
        running = running.plus(D(l.debit)).minus(D(l.credit))
        td = td.plus(D(l.debit))
        tc = tc.plus(D(l.credit))
        const lineAccount = accountOf(db, l)
        const party = l.party_id ? (db.parties.find((p) => p.id === l.party_id) ?? null) : null
        return {
          line_id: l.id,
          entry_id: e.id,
          entry_number: e.number,
          entry_date: e.entry_date,
          entry_type: e.entry_type,
          entry_status: e.status,
          line_no: l.line_no,
          account_id: l.account_id,
          account_code: lineAccount?.code ?? '',
          account_name: lineAccount?.name ?? '',
          description: l.description ?? e.description,
          debit: l.debit,
          credit: l.credit,
          running_balance: f4(running),
          party_id: l.party_id,
          party,
          document_ref: l.document_ref,
          due_date: l.due_date,
          currency_code: l.currency_code,
          fx_amount: l.fx_amount,
        }
      })
      const page = paginate(rows, url, 500, 100)
      return HttpResponse.json({
        data: page.data,
        meta: {
          ...page.meta,
          date_from: from,
          date_to: to,
          period_id: r.periodId,
          source: 'lines',
          account: {
            id: acc.id,
            code: acc.code,
            name: acc.name,
            normal_balance: acc.normal_balance,
            is_postable: acc.is_postable,
            currency_code: acc.currency_code,
            requires_party: acc.requires_party,
            requires_cost_center: acc.requires_cost_center,
            requires_project: acc.requires_project,
          },
          opening_balance: f4(opening),
          closing_balance: f4(running),
          totals: { debit: f4(td), credit: f4(tc) },
        },
      })
    }),
    http.get(`${API}/reports/journal-book`, ({ request }) => {
      const url = new URL(request.url)
      const r = range(db, url)
      if (r instanceof Response) return r
      const { from, to } = r
      const perPage = Number(url.searchParams.get('per_page') ?? 100)
      if (perPage > 500) return validation({ per_page: ['En çok 500.'] })
      const entries = booked(db)
        .filter((e) => e.entry_date >= from && e.entry_date <= to && e.number)
        .sort((a, b) => String(a.number).localeCompare(String(b.number)))
        .map((e) => ({
          id: e.id,
          number: e.number ?? '',
          entry_date: e.entry_date,
          entry_type: e.entry_type,
          status: e.status,
          description: e.description,
          total_debit: e.total_debit,
          total_credit: e.total_credit,
          lines: e.lines.map((l) => {
            const acc = accountOf(db, l)
            return {
              line_no: l.line_no,
              account_id: l.account_id,
              account_code: acc?.code ?? '',
              account_name: acc?.name ?? '',
              description: l.description,
              debit: l.debit,
              credit: l.credit,
              party_id: l.party_id,
            }
          }),
        }))
      const page = paginate(entries, url, 500, 100)
      const sum = (list: typeof entries) => ({
        d: list.reduce((s, e) => s.plus(D(e.total_debit)), ZERO),
        c: list.reduce((s, e) => s.plus(D(e.total_credit)), ZERO),
      })
      const { current_page: current, per_page: size } = page.meta.pagination
      const before = sum(entries.slice(0, (current - 1) * size))
      const onPage = sum(page.data)
      const all = sum(entries)
      const carried = {
        d: D(db.bookCarriedForward.debit),
        c: D(db.bookCarriedForward.credit),
      }
      const pair = (s: { d: Decimal; c: Decimal }) => ({ debit: f4(s.d), credit: f4(s.c) })
      const brought = { d: carried.d.plus(before.d), c: carried.c.plus(before.c) }
      return HttpResponse.json({
        data: page.data,
        meta: {
          ...page.meta,
          date_from: from,
          date_to: to,
          period_id: r.periodId,
          source: 'lines',
          carried_forward: pair(carried),
          page_brought_forward: pair(brought),
          page_totals: pair(onPage),
          page_carried_forward: pair({ d: brought.d.plus(onPage.d), c: brought.c.plus(onPage.c) }),
          range_totals: pair(all),
        },
      })
    }),
  ]
}

/** Calendar day before `date` (YYYY-MM-DD). */
function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
