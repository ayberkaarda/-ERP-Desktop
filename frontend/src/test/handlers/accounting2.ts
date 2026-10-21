import Decimal from 'decimal.js'
import { http, HttpResponse } from 'msw'
import type {
  AccountingPeriod,
  AccountRef,
  JournalEntry,
  JournalLine,
  NamedRef,
} from '@/features/accounting/journal/types'

// In-memory stand-in for the journal entry and report endpoints (PHASE3 "HTTP API" and
// "Reports") plus the read-only lookups they use (accounts, parties, cost centers, projects,
// periods).

export interface Account extends AccountRef {
  parent_id: string | null
  level: number
  is_postable: boolean
  is_active: boolean
}

export interface Accounting2Db {
  accounts: Account[]
  parties: NamedRef[]
  costCenters: NamedRef[]
  projects: NamedRef[]
  periods: AccountingPeriod[]
  entries: JournalEntry[]
  /** Opening "devreden" of the journal book (entries before the range). */
  bookCarriedForward: { debit: string; credit: string }
  calls: { method: string; path: string; body: unknown; headers: Headers; url: URL }[]
  idempotency: Map<string, { body: string; response: { data: JournalEntry } }>
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
export const ENTRY_DRAFT = 'je-draft'
export const ENTRY_POSTED = 'je-posted'

const account = (id: string, code: string, name: string, over: Partial<Account> = {}): Account => ({
  id,
  code,
  name,
  currency_code: null,
  requires_party: false,
  requires_cost_center: false,
  requires_project: false,
  is_postable: true,
  is_active: true,
  normal_balance: 'debit',
  parent_id: null,
  level: 1,
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
  })
  const receivables = account(ACC_RECEIVABLES, '120', 'Alıcılar', { requires_party: true })
  const sales = account(ACC_SALES, '600', 'Yurt İçi Satışlar', { normal_balance: 'credit' })
  const vat = account(ACC_VAT, '391', 'Hesaplanan KDV', { normal_balance: 'credit' })
  const expenses = account(ACC_EXPENSES, '770', 'Genel Yönetim Giderleri', {
    requires_cost_center: true,
  })
  const acme = { id: PARTY_ACME, code: 'P000001', name: 'Acme Ticaret A.Ş.' }
  return {
    accounts: [cash, banks, bankTry, bankUsd, receivables, sales, vat, expenses],
    parties: [acme, { id: 'party-beta', code: 'P000002', name: 'Beta Lojistik Ltd.' }],
    costCenters: [{ id: CC_ADMIN, code: 'GY', name: 'Genel yönetim' }],
    projects: [{ id: 'prj-1', code: 'PRJ1', name: 'Fabrika genişletme' }],
    periods: [
      {
        id: PERIOD_JAN,
        fiscal_year_id: 'fy-2026',
        fiscal_year: { id: 'fy-2026', code: '2026' },
        number: 1,
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
        created_at: '2026-01-10T11:00:00Z',
        posted_by_user: { id: 'u1', name: 'Deniz Kaya' },
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

function error(status: number, code: string, message: string, fields?: Record<string, string[]>) {
  return HttpResponse.json({ errors: { message, code, ...(fields ? { fields } : {}) } }, { status })
}
const validation = (fields: Record<string, string[]>) =>
  error(422, 'VALIDATION_FAILED', 'Gönderilen bilgiler geçersiz.', fields)
const notFound = () => error(404, 'NOT_FOUND', 'Kayıt bulunamadı.')
const conflict = () =>
  error(409, 'VERSION_CONFLICT', 'Kayıt siz düzenlerken başka biri tarafından değiştirildi.')

function paginate<T>(rows: T[], url: URL, maxPerPage = 100) {
  const perPage = Math.min(maxPerPage, Number(url.searchParams.get('per_page') ?? 25))
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

function summary(e: JournalEntry) {
  const { lines, ...rest } = e
  return { ...rest, line_count: lines.length }
}

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

function range(db: Accounting2Db, url: URL): { from: string; to: string } {
  const periodId = url.searchParams.get('period_id')
  const period = periodId ? db.periods.find((p) => p.id === periodId) : undefined
  if (period) return { from: period.start_date, to: period.end_date }
  return {
    from: url.searchParams.get('date_from') ?? '0000-01-01',
    to: url.searchParams.get('date_to') ?? '9999-12-31',
  }
}

const posted = (db: Accounting2Db) => db.entries.filter((e) => e.status !== 'draft')

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

function validateEntry(db: Accounting2Db, body: Row): Record<string, string[]> | null {
  const fields: Record<string, string[]> = {}
  const lines = Array.isArray(body.lines) ? (body.lines as LineBody[]) : []
  if (typeof body.entry_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.entry_date))
    fields.entry_date = ['Tarih geçersiz.']
  if (lines.length === 0) fields.lines = ['En az bir satır gerekli.']
  if (lines.length > 500) fields.lines = ['En çok 500 satır olabilir.']
  lines.forEach((l, i) => {
    const acc = db.accounts.find((a) => a.id === l.account_id)
    if (!acc) fields[`lines.${i}.account_id`] = ['Hesap bulunamadı.']
    else if (!acc.is_postable) fields[`lines.${i}.account_id`] = ['Hesap kayıt kabul etmiyor.']
    const d = D(l.debit)
    const c = D(l.credit)
    if (d.isNeg() || c.isNeg() || (d.gt(0) && c.gt(0)) || d.plus(c).isZero())
      fields[`lines.${i}.debit`] = ['Borç ya da alacaktan yalnız biri dolu olmalı.']
    if (acc?.requires_party && !l.party_id) fields[`lines.${i}.party_id`] = ['Cari zorunlu.']
    if (acc?.requires_cost_center && !l.cost_center_id)
      fields[`lines.${i}.cost_center_id`] = ['Masraf merkezi zorunlu.']
    if (acc?.currency_code && (!l.fx_amount || !l.fx_rate))
      fields[`lines.${i}.fx_amount`] = ['Döviz tutarı ve kur zorunlu.']
  })
  return Object.keys(fields).length ? fields : null
}

function buildLines(db: Accounting2Db, entryId: string, lines: LineBody[]): JournalLine[] {
  return lines.map((l, i) => {
    const acc = db.accounts.find((a) => a.id === l.account_id) ?? null
    const ref = (list: NamedRef[], id: string | null | undefined) =>
      id ? (list.find((r) => r.id === id) ?? null) : null
    return {
      id: `${entryId}-l${i + 1}`,
      line_no: i + 1,
      account_id: l.account_id ?? '',
      account: acc,
      debit: f4(D(l.debit)),
      credit: f4(D(l.credit)),
      currency_code: l.currency_code ?? null,
      fx_amount: l.fx_amount ?? null,
      fx_rate: l.fx_rate ?? null,
      party_id: l.party_id ?? null,
      party: ref(db.parties, l.party_id),
      cost_center_id: l.cost_center_id ?? null,
      cost_center: ref(db.costCenters, l.cost_center_id),
      project_id: l.project_id ?? null,
      project: ref(db.projects, l.project_id),
      description: l.description ?? null,
      due_date: null,
      document_ref: l.document_ref ?? null,
    }
  })
}

function totals(lines: JournalLine[]) {
  return {
    total_debit: f4(lines.reduce((s, l) => s.plus(D(l.debit)), new Decimal(0))),
    total_credit: f4(lines.reduce((s, l) => s.plus(D(l.credit)), new Decimal(0))),
  }
}

function nextNumber(db: Accounting2Db, date: string) {
  const n = db.numberSeq
  db.numberSeq += 1
  // numberSeq starts after the seeded posted entry.
  return `${date.slice(0, 4)}/${String(n + 1).padStart(6, '0')}`
}

function csv(rows: string[][]) {
  return new HttpResponse(rows.map((r) => r.join(';')).join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  })
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

  return [
    record,
    // ---- lookups ------------------------------------------------------------------------
    http.get(`${API}/accounts`, ({ request }) => {
      const url = new URL(request.url)
      const q = url.searchParams.get('q') ?? ''
      let rows = db.accounts.filter((a) => searchIn(q, a.code, a.name))
      if (url.searchParams.get('filter[postable]') === '1') rows = rows.filter((a) => a.is_postable)
      if (url.searchParams.get('filter[active]') === '1') rows = rows.filter((a) => a.is_active)
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
    http.get(`${API}/accounting-periods`, ({ request }) =>
      HttpResponse.json(paginate(db.periods, new URL(request.url))),
    ),

    // ---- journal entries ----------------------------------------------------------------
    http.get(`${API}/journal-entries/export`, ({ request }) => {
      const url = new URL(request.url)
      if (!['csv', 'xlsx'].includes(url.searchParams.get('format') ?? ''))
        return validation({ format: ['Geçersiz biçim.'] })
      return csv([
        ['number', 'entry_date', 'total_debit'],
        ...db.entries.map((e) => [e.number ?? '', e.entry_date, e.total_debit]),
      ])
    }),
    http.get(`${API}/journal-entries`, ({ request }) => {
      const url = new URL(request.url)
      const p = (k: string) => url.searchParams.get(`filter[${k}]`) ?? ''
      const q = url.searchParams.get('q') ?? ''
      let rows = db.entries.filter((e) => searchIn(q, e.number, e.description))
      if (p('date_from')) rows = rows.filter((e) => e.entry_date >= p('date_from'))
      if (p('date_to')) rows = rows.filter((e) => e.entry_date <= p('date_to'))
      if (p('entry_type'))
        rows = rows.filter((e) => p('entry_type').split(',').includes(e.entry_type))
      if (p('status')) rows = rows.filter((e) => p('status').split(',').includes(e.status))
      if (p('account_id')) {
        const ids = subtree(db, p('account_id'))
        rows = rows.filter((e) => e.lines.some((l) => ids.has(l.account_id)))
      }
      if (p('party_id'))
        rows = rows.filter((e) => e.lines.some((l) => l.party_id === p('party_id')))
      if (p('amount_min')) rows = rows.filter((e) => D(e.total_debit).gte(p('amount_min')))
      if (p('amount_max')) rows = rows.filter((e) => D(e.total_debit).lte(p('amount_max')))
      const sort = url.searchParams.get('sort') ?? '-entry_date'
      const desc = sort.startsWith('-')
      const key = (desc ? sort.slice(1) : sort) as 'entry_date' | 'number' | 'total_debit'
      if (!['entry_date', 'number', 'total_debit'].includes(key))
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
      return row ? HttpResponse.json({ data: row }) : notFound()
    }),
    http.post(`${API}/journal-entries`, async ({ request }) => {
      const key = request.headers.get('Idempotency-Key')
      if (!key) return error(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key gerekli.')
      const raw = await request.text()
      const seen = db.idempotency.get(key)
      if (seen) {
        if (seen.body !== raw)
          return error(422, 'IDEMPOTENCY_KEY_REUSED', 'Anahtar başka bir istekte kullanıldı.')
        return HttpResponse.json(seen.response, { status: 201 })
      }
      const body = JSON.parse(raw) as Row
      const problems = validateEntry(db, body)
      if (problems) return validation(problems)
      db.seq += 1
      const id = `je-new-${db.seq}`
      const lines = buildLines(db, id, body.lines as LineBody[])
      const entry: JournalEntry = {
        id,
        number: null,
        entry_type: body.entry_type as JournalEntry['entry_type'],
        entry_date: body.entry_date as string,
        period_id: PERIOD_JAN,
        description: (body.description as string | null) ?? null,
        status: 'draft',
        source_type: null,
        source_id: null,
        reverses_id: null,
        reversed_by_id: null,
        posted_at: null,
        created_at: '2026-01-21T10:00:00Z',
        version: 1,
        lines,
        ...totals(lines),
      }
      db.entries.push(entry)
      const response = { data: entry }
      db.idempotency.set(key, { body: raw, response })
      return HttpResponse.json(response, { status: 201 })
    }),
    http.patch(`${API}/journal-entries/:id`, async ({ params, request }) => {
      const entry = find(String(params.id))
      if (!entry) return notFound()
      const body = (await request.json()) as Row
      if (body.version !== entry.version) return conflict()
      if (entry.status !== 'draft')
        return error(422, 'INVALID_STATE_TRANSITION', 'Yalnız taslak fiş değiştirilebilir.')
      const problems = validateEntry(db, body)
      if (problems) return validation(problems)
      const lines = buildLines(db, entry.id, body.lines as LineBody[])
      Object.assign(entry, {
        entry_type: body.entry_type,
        entry_date: body.entry_date,
        description: body.description ?? null,
        lines,
        version: entry.version + 1,
        ...totals(lines),
      })
      return HttpResponse.json({ data: entry })
    }),
    http.delete(`${API}/journal-entries/:id`, ({ params, request }) => {
      const entry = find(String(params.id))
      if (!entry) return notFound()
      const version = new URL(request.url).searchParams.get('version')
      if (version !== null && Number(version) !== entry.version) return conflict()
      if (entry.status !== 'draft')
        return error(422, 'INVALID_STATE_TRANSITION', 'Yalnız taslak fiş silinebilir.')
      db.entries = db.entries.filter((e) => e !== entry)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/journal-entries/:id/post`, async ({ params, request }) => {
      const entry = find(String(params.id))
      if (!entry) return notFound()
      const body = (await request.json()) as Row
      if (body.version !== entry.version) return conflict()
      if (entry.status !== 'draft')
        return error(422, 'INVALID_STATE_TRANSITION', 'Fiş zaten kesinleşmiş.')
      if (!D(entry.total_debit).eq(D(entry.total_credit)))
        return error(422, 'ENTRY_NOT_BALANCED', 'Borç ve alacak toplamları eşit değil.')
      Object.assign(entry, {
        status: 'posted',
        number: nextNumber(db, entry.entry_date),
        posted_at: '2026-01-21T10:05:00Z',
        posted_by_user: { id: 'u1', name: 'Deniz Kaya' },
        version: entry.version + 1,
      })
      return HttpResponse.json({ data: entry })
    }),
    http.post(`${API}/journal-entries/:id/reverse`, async ({ params, request }) => {
      const entry = find(String(params.id))
      if (!entry) return notFound()
      const body = (await request.json()) as Row
      const fields: Record<string, string[]> = {}
      if (typeof body.date !== 'string' || body.date < entry.entry_date)
        fields.date = ['Ters kayıt tarihi asıl fişten önce olamaz.']
      if (typeof body.reason !== 'string' || body.reason.trim().length < 3)
        fields.reason = ['Gerekçe zorunlu.']
      if (Object.keys(fields).length) return validation(fields)
      if (entry.status !== 'posted')
        return error(422, 'INVALID_STATE_TRANSITION', 'Yalnız kesinleşmiş fiş ters kaydedilebilir.')
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
        reverses: { id: entry.id, number: entry.number },
        reversed_by_id: null,
        reversed_by: null,
        reversal_reason: body.reason as string,
        version: 1,
        lines,
        ...totals(lines),
      }
      Object.assign(entry, {
        status: 'reversed',
        reversed_by_id: id,
        reversed_by: { id, number: reversal.number },
        reversal_reason: body.reason,
        version: entry.version + 1,
      })
      db.entries.push(reversal)
      return HttpResponse.json({ data: reversal }, { status: 201 })
    }),

    // ---- reports ------------------------------------------------------------------------
    http.get(`${API}/reports/:report/export`, ({ request }) => {
      const url = new URL(request.url)
      if (!['csv', 'xlsx'].includes(url.searchParams.get('format') ?? ''))
        return validation({ format: ['Geçersiz biçim.'] })
      return csv([['report'], [url.pathname]])
    }),
    http.get(`${API}/reports/trial-balance`, ({ request }) => {
      const url = new URL(request.url)
      const { from, to } = range(db, url)
      const level = Number(url.searchParams.get('level') ?? 9)
      const includeZero = url.searchParams.get('include_zero') === '1'
      const compare = url.searchParams.get('compare_with_previous_year') === '1'
      const yearStart = `${from.slice(0, 4)}-01-01`
      const shift = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`
      const sums = (lo: string, hi: string) => {
        const m = new Map<string, { d: Decimal; c: Decimal }>()
        for (const e of posted(db)) {
          if (e.entry_date < lo || e.entry_date > hi) continue
          for (const l of e.lines) {
            // Roll each line up to every ancestor.
            let acc = db.accounts.find((a) => a.id === l.account_id)
            while (acc) {
              const cur = m.get(acc.id) ?? { d: new Decimal(0), c: new Decimal(0) }
              m.set(acc.id, { d: cur.d.plus(D(l.debit)), c: cur.c.plus(D(l.credit)) })
              const parent: string | null = acc.parent_id
              acc = parent ? db.accounts.find((a) => a.id === parent) : undefined
            }
          }
        }
        return m
      }
      const zero = { d: new Decimal(0), c: new Decimal(0) }
      const none = new Map<string, { d: Decimal; c: Decimal }>()
      const openingMap = from > yearStart ? sums(yearStart, prevDay(from)) : none
      const moveMap = sums(from, to)
      const prevMap = compare ? sums(shift(yearStart), shift(to)) : none
      const side = (d: Decimal) => ({
        debit: f4(d.gt(0) ? d : new Decimal(0)),
        credit: f4(d.lt(0) ? d.abs() : new Decimal(0)),
      })
      const rows = db.accounts
        .filter((a) => a.level <= level)
        .map((a) => {
          const o = openingMap.get(a.id) ?? zero
          const m = moveMap.get(a.id) ?? zero
          const p = prevMap.get(a.id) ?? zero
          const bal = side(o.d.minus(o.c).plus(m.d).minus(m.c))
          const prev = side(p.d.minus(p.c))
          return {
            account_id: a.id,
            code: a.code,
            name: a.name,
            level: a.level,
            parent_id: a.parent_id,
            tdhp_group: Number(a.code[0]),
            is_postable: a.is_postable,
            opening_debit: f4(o.d),
            opening_credit: f4(o.c),
            debit: f4(m.d),
            credit: f4(m.c),
            balance_debit: bal.debit,
            balance_credit: bal.credit,
            previous: compare
              ? {
                  debit: f4(p.d),
                  credit: f4(p.c),
                  balance_debit: prev.debit,
                  balance_credit: prev.credit,
                }
              : null,
          }
        })
        .filter(
          (r) =>
            includeZero ||
            !(
              D(r.debit).isZero() &&
              D(r.credit).isZero() &&
              D(r.opening_debit).isZero() &&
              D(r.opening_credit).isZero()
            ),
        )
      const roots = rows.filter((r) => !r.parent_id)
      const sum = (
        k:
          | 'opening_debit'
          | 'opening_credit'
          | 'debit'
          | 'credit'
          | 'balance_debit'
          | 'balance_credit',
      ) => f4(roots.reduce((s, r) => s.plus(D(r[k])), new Decimal(0)))
      const t = {
        opening_debit: sum('opening_debit'),
        opening_credit: sum('opening_credit'),
        debit: sum('debit'),
        credit: sum('credit'),
        balance_debit: sum('balance_debit'),
        balance_credit: sum('balance_credit'),
      }
      return HttpResponse.json({
        data: {
          date_from: from,
          date_to: to,
          rows,
          totals: t,
          previous_totals: compare
            ? {
                debit: f4(roots.reduce((s, r) => s.plus(D(r.previous?.debit)), new Decimal(0))),
                credit: f4(roots.reduce((s, r) => s.plus(D(r.previous?.credit)), new Decimal(0))),
                balance_debit: f4(
                  roots.reduce((s, r) => s.plus(D(r.previous?.balance_debit)), new Decimal(0)),
                ),
                balance_credit: f4(
                  roots.reduce((s, r) => s.plus(D(r.previous?.balance_credit)), new Decimal(0)),
                ),
              }
            : null,
          balanced: D(t.debit).eq(D(t.credit)),
        },
      })
    }),
    http.get(`${API}/reports/general-ledger`, ({ request }) => {
      const url = new URL(request.url)
      const accountId = url.searchParams.get('account_id') ?? ''
      const acc = db.accounts.find((a) => a.id === accountId)
      if (!acc) return validation({ account_id: ['Hesap seçin.'] })
      const ids = subtree(db, accountId)
      const { from, to } = range(db, url)
      let opening = new Decimal(0)
      const movements: { e: JournalEntry; l: JournalLine }[] = []
      for (const e of [...posted(db)].sort((a, b) =>
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
      let td = new Decimal(0)
      let tc = new Decimal(0)
      const rows = movements.map(({ e, l }) => {
        running = running.plus(D(l.debit)).minus(D(l.credit))
        td = td.plus(D(l.debit))
        tc = tc.plus(D(l.credit))
        return {
          line_id: l.id,
          entry_id: e.id,
          entry_number: e.number,
          entry_date: e.entry_date,
          entry_type: e.entry_type,
          description: l.description ?? e.description,
          debit: l.debit,
          credit: l.credit,
          running_balance: f4(running),
          party: l.party ?? null,
        }
      })
      const page = paginate(rows, url)
      return HttpResponse.json({
        data: page.data,
        meta: {
          ...page.meta,
          account: acc,
          opening_balance: f4(opening),
          closing_balance: f4(running),
          totals: { debit: f4(td), credit: f4(tc) },
        },
      })
    }),
    http.get(`${API}/reports/journal-book`, ({ request }) => {
      const url = new URL(request.url)
      const { from, to } = range(db, url)
      const rows = posted(db)
        .filter((e) => e.entry_date >= from && e.entry_date <= to && e.number)
        .sort((a, b) => String(a.number).localeCompare(String(b.number)))
        .map((e) => ({
          id: e.id,
          number: e.number ?? '',
          entry_date: e.entry_date,
          entry_type: e.entry_type,
          description: e.description,
          lines: e.lines.map((l) => ({
            line_no: l.line_no,
            account_code: l.account?.code ?? '',
            account_name: l.account?.name ?? '',
            description: l.description,
            debit: l.debit,
            credit: l.credit,
          })),
        }))
      const page = paginate(rows, url)
      return HttpResponse.json({
        data: page.data,
        meta: { ...page.meta, carried_forward: db.bookCarriedForward },
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
