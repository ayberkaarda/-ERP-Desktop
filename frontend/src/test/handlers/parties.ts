import { http, HttpResponse } from 'msw'
import { ibanProblem, normalizeIban } from '@/features/parties/lib/iban'
import { taxNumberProblem } from '@/features/parties/lib/taxNumber'
import type {
  ApiActivity,
  Party,
  PartyAddress,
  PartyBankAccount,
  PartyContact,
  PartyInput,
} from '@/features/parties/types'

// In-memory stand-in for the Parties API (PHASE2 "Parties module endpoints").

type Sub = 'addresses' | 'contacts' | 'bank-accounts'
type SubRow = (PartyAddress | PartyContact | PartyBankAccount) & {
  party_id: string
  version: number
}

export interface PartiesDb {
  parties: Party[]
  addresses: (PartyAddress & { party_id: string; version: number })[]
  contacts: (PartyContact & { party_id: string; version: number })[]
  'bank-accounts': (PartyBankAccount & { party_id: string; version: number })[]
  audit: (ApiActivity & { subject_id: string })[]
  calls: { method: string; path: string; body: unknown; headers: Headers }[]
  nextCode: number
}

let seq = 0
const uuid = () => `0192b000-0000-7000-8000-${String(++seq).padStart(12, '0')}`

export function makeParty(overrides: Partial<Party> = {}): Party {
  return {
    id: uuid(),
    code: 'P000001',
    name: 'Anadolu Makina A.Ş.',
    legal_name: null,
    type: 'company',
    roles: ['customer'],
    tax_office: 'Kadıköy',
    tax_number: null,
    country: 'TR',
    default_currency_code: 'TRY',
    payment_term_id: null,
    price_list_id: null,
    risk_limit: null,
    risk_currency_code: null,
    is_active: true,
    notes: null,
    tags: [],
    version: 1,
    ...overrides,
  }
}

export function createPartiesDb(overrides: Partial<PartiesDb> = {}): PartiesDb {
  return {
    parties: [],
    addresses: [],
    contacts: [],
    'bank-accounts': [],
    audit: [],
    calls: [],
    nextCode: 100,
    ...overrides,
  }
}

const validation = (fields: Record<string, string[]>) =>
  HttpResponse.json(
    { errors: { message: 'Doğrulama başarısız.', code: 'VALIDATION_FAILED', fields } },
    { status: 422 },
  )
const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ errors: { message, code } }, { status })

function validateParty(db: PartiesDb, p: Party): Record<string, string[]> {
  const fields: Record<string, string[]> = {}
  if (!p.name.trim()) fields.name = ['Ad zorunludur.']
  if (p.roles.length === 0) fields.roles = ['En az bir rol seçilmelidir.']
  if (p.tax_number && taxNumberProblem(p.tax_number, p.country, p.type)) {
    fields.tax_number = ['Vergi numarası geçersiz.']
  }
  if (
    p.tax_number &&
    db.parties.some((o) => o.id !== p.id && o.is_active && o.tax_number === p.tax_number)
  ) {
    fields.tax_number = ['Bu vergi numarasıyla kayıtlı aktif bir cari var.']
  }
  return fields
}

function compare(a: unknown, b: unknown): number {
  const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? ''))
  return text(a).localeCompare(text(b), 'tr')
}

export function partiesHandlers(db: PartiesDb) {
  const record = async (request: Request) => {
    const url = new URL(request.url)
    let body: unknown = null
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      body = await request
        .clone()
        .json()
        .catch(() => null)
    }
    db.calls.push({ method: request.method, path: url.pathname, body, headers: request.headers })
    return url
  }
  const find = (id: string) => db.parties.find((p) => p.id === id)

  return [
    http.get('*/api/v1/parties/duplicates', async ({ request }) => {
      const url = await record(request)
      const tax = url.searchParams.get('tax_number') ?? ''
      const name = (url.searchParams.get('name') ?? '').toLocaleLowerCase('tr')
      const data = db.parties
        .map((p) => {
          if (tax && p.tax_number === tax) return { p, match: 'tax_number' as const }
          if (name && p.name.toLocaleLowerCase('tr').includes(name))
            return { p, match: 'name' as const }
          return null
        })
        .filter((x) => x !== null)
        .map(({ p, match }) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          tax_number: p.tax_number,
          is_active: p.is_active,
          match,
        }))
      return HttpResponse.json({ data })
    }),

    http.get('*/api/v1/parties', async ({ request }) => {
      const url = await record(request)
      const sp = url.searchParams
      const q = (sp.get('q') ?? '').toLocaleLowerCase('tr')
      let rows = db.parties.filter((p) => {
        const role = sp.get('filter[role]')
        const active = sp.get('filter[is_active]')
        const country = sp.get('filter[country]')
        if (role && !p.roles.includes(role as Party['roles'][number])) return false
        if (active && p.is_active !== (active === '1')) return false
        if (country && p.country !== country) return false
        if (!q) return true
        return [p.name, p.legal_name, p.code, p.tax_number].some((v) =>
          (v ?? '').toLocaleLowerCase('tr').includes(q),
        )
      })
      const sort = sp.get('sort')
      if (sort) {
        const desc = sort.startsWith('-')
        const key = sort.replace(/^-/, '').split(',')[0] as keyof Party
        rows = [...rows].sort((a, b) => (desc ? -1 : 1) * compare(a[key], b[key]))
      }
      const perPage = Math.min(Number(sp.get('per_page') ?? 25), 100)
      const page = Math.max(Number(sp.get('page') ?? 1), 1)
      return HttpResponse.json({
        data: rows.slice((page - 1) * perPage, page * perPage),
        meta: {
          pagination: {
            current_page: page,
            per_page: perPage,
            total: rows.length,
            last_page: Math.max(1, Math.ceil(rows.length / perPage)),
          },
        },
      })
    }),

    http.post('*/api/v1/parties', async ({ request }) => {
      await record(request)
      if (!request.headers.get('Idempotency-Key')) {
        return fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key gerekli.')
      }
      const input = (await request.json()) as PartyInput
      const party = makeParty({ ...input, code: `P${String(db.nextCode).padStart(6, '0')}` })
      const fields = validateParty(db, party)
      if (Object.keys(fields).length) return validation(fields)
      db.nextCode += 1
      db.parties.push(party)
      return HttpResponse.json({ data: party }, { status: 201 })
    }),

    http.get('*/api/v1/parties/:id', async ({ request, params }) => {
      await record(request)
      const party = find(String(params.id))
      return party ? HttpResponse.json({ data: party }) : fail(404, 'NOT_FOUND', 'Bulunamadı.')
    }),

    http.patch('*/api/v1/parties/:id', async ({ request, params }) => {
      await record(request)
      const party = find(String(params.id))
      if (!party) return fail(404, 'NOT_FOUND', 'Bulunamadı.')
      const patch = (await request.json()) as Partial<Party> & { version?: number }
      if (patch.version !== party.version) {
        return fail(409, 'VERSION_CONFLICT', 'Kayıt başka biri tarafından değiştirildi.')
      }
      const next: Party = { ...party, ...patch, version: party.version + 1 }
      const fields = validateParty(db, next)
      if (Object.keys(fields).length) return validation(fields)
      Object.assign(party, next)
      return HttpResponse.json({ data: party })
    }),

    http.delete('*/api/v1/parties/:id', async ({ request, params }) => {
      await record(request)
      const id = String(params.id)
      if (!find(id)) return fail(404, 'NOT_FOUND', 'Bulunamadı.')
      db.parties = db.parties.filter((p) => p.id !== id)
      return new HttpResponse(null, { status: 204 })
    }),

    http.get('*/api/v1/parties/:id/:sub', async ({ request, params }) => {
      await record(request)
      const sub = String(params.sub) as Sub
      const rows = (db[sub] as SubRow[]).filter((r) => r.party_id === String(params.id))
      return HttpResponse.json({ data: rows })
    }),

    http.post('*/api/v1/parties/:id/:sub', async ({ request, params }) => {
      await record(request)
      if (!request.headers.get('Idempotency-Key')) {
        return fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key gerekli.')
      }
      const sub = String(params.sub) as Sub
      const body = (await request.json()) as Record<string, unknown>
      const fields = validateSub(sub, body)
      if (Object.keys(fields).length) return validation(fields)
      const row = { ...body, id: uuid(), party_id: String(params.id), version: 1 } as SubRow
      ;(db[sub] as SubRow[]).push(row)
      clearSiblings(db, sub, row)
      return HttpResponse.json({ data: row }, { status: 201 })
    }),

    http.patch('*/api/v1/parties/:id/:sub/:rowId', async ({ request, params }) => {
      await record(request)
      const sub = String(params.sub) as Sub
      const row = (db[sub] as SubRow[]).find((r) => r.id === String(params.rowId))
      if (!row) return fail(404, 'NOT_FOUND', 'Bulunamadı.')
      const body = (await request.json()) as Record<string, unknown>
      if (body.version !== undefined && body.version !== row.version) {
        return fail(409, 'VERSION_CONFLICT', 'Satır değiştirildi.')
      }
      const fields = validateSub(sub, { ...row, ...body })
      if (Object.keys(fields).length) return validation(fields)
      Object.assign(row, body, { version: row.version + 1 })
      clearSiblings(db, sub, row)
      return HttpResponse.json({ data: row })
    }),

    http.delete('*/api/v1/parties/:id/:sub/:rowId', async ({ request, params }) => {
      await record(request)
      const sub = String(params.sub) as Sub
      ;(db as unknown as Record<Sub, SubRow[]>)[sub] = (db[sub] as SubRow[]).filter(
        (r) => r.id !== String(params.rowId),
      )
      return new HttpResponse(null, { status: 204 })
    }),

    http.get('*/api/v1/logs/audit', async ({ request }) => {
      const url = await record(request)
      const id = url.searchParams.get('filter[subject_id]')
      const data = db.audit.filter((a) => a.subject_id === id)
      return HttpResponse.json({
        data,
        meta: { pagination: { current_page: 1, per_page: 20, total: data.length, last_page: 1 } },
      })
    }),
  ]
}

function validateSub(sub: Sub, body: Record<string, unknown>): Record<string, string[]> {
  const fields: Record<string, string[]> = {}
  if (
    sub === 'bank-accounts' &&
    ibanProblem(normalizeIban(typeof body.iban === 'string' ? body.iban : ''))
  ) {
    fields.iban = ['IBAN geçersiz.']
  }
  return fields
}

/** Single default: setting the flag on one row clears it on its siblings (address: per type). */
function clearSiblings(db: PartiesDb, sub: Sub, row: SubRow) {
  const flag = sub === 'contacts' ? 'is_primary' : 'is_default'
  const r = row as unknown as Record<string, unknown>
  if (r[flag] !== true) return
  for (const other of db[sub] as SubRow[]) {
    const o = other as unknown as Record<string, unknown>
    if (other.id === row.id || other.party_id !== row.party_id) continue
    if (sub === 'addresses' && o.type !== r.type) continue
    o[flag] = false
  }
}
