import { http, HttpResponse } from 'msw'
import { ibanProblem, normalizeIban } from '@/features/parties/lib/iban'
import { taxNumberProblem } from '@/features/parties/lib/taxNumber'
import type {
  ApiActivity,
  DuplicateReason,
  Party,
  PartyAddress,
  PartyBankAccount,
  PartyContact,
  PartyDuplicate,
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
  calls: { method: string; path: string; search: string; body: unknown; headers: Headers }[]
  nextCode: number
  /** Idempotency-Key -> request body + created party, for replays like the API's middleware. */
  idempotency: Map<string, { body: string; party: Party }>
  /** The next create succeeds on the server but its response is lost (network error). */
  dropNextCreateResponse: boolean
  /** PATCHes to these parties fail with 500. */
  failPatchIds: Set<string>
  /** Parties referenced elsewhere: DELETE deactivates them (200 + meta.action) like the API. */
  inUseIds: Set<string>
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
    idempotency: new Map(),
    dropNextCreateResponse: false,
    failPatchIds: new Set(),
    inUseIds: new Set(),
    ...overrides,
  }
}

const validation = (fields: Record<string, string[]>) =>
  HttpResponse.json(
    { errors: { message: 'Doğrulama başarısız.', code: 'VALIDATION_ERROR', fields } },
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
    db.calls.push({
      method: request.method,
      path: url.pathname,
      search: url.search,
      body,
      headers: request.headers,
    })
    return url
  }
  const find = (id: string) => db.parties.find((p) => p.id === id)

  return [
    // PartyController::export: same filters as the list, CSV by default, XLSX on request.
    http.get('*/api/v1/parties/export', async ({ request }) => {
      const url = await record(request)
      const format = url.searchParams.get('format') ?? 'csv'
      if (!['csv', 'xlsx'].includes(format)) return validation({ format: ['Geçersiz biçim.'] })
      if (format === 'xlsx') {
        return new HttpResponse(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]), {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="parties-20260121-100000.xlsx"',
          },
        })
      }
      const csv = ['code,name', ...db.parties.map((p) => `${p.code},${p.name}`)].join('\n')
      return new HttpResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=UTF-8',
          'Content-Disposition': 'attachment; filename="parties-20260121-100000.csv"',
        },
      })
    }),
    http.get('*/api/v1/parties/duplicates', async ({ request }) => {
      const url = await record(request)
      const tax = url.searchParams.get('tax_number') ?? ''
      const name = (url.searchParams.get('name') ?? '').toLocaleLowerCase('tr')
      const exclude = url.searchParams.get('exclude_id')
      if (!tax && !name) {
        const message = 'Vergi numarası veya ad gerekli.'
        return validation({ tax_number: [message], name: [message] })
      }
      // DuplicateResource: tax number matches first, reasons list every input that matched.
      const data = db.parties
        .filter((p) => p.id !== exclude)
        .map((p) => {
          const reasons: DuplicateReason[] = []
          if (tax && p.tax_number === tax) reasons.push('tax_number')
          if (name && p.name.toLocaleLowerCase('tr').includes(name)) reasons.push('name')
          return { p, reasons }
        })
        .filter((x) => x.reasons.length > 0)
        .map(({ p, reasons }): PartyDuplicate => ({
          id: p.id,
          code: p.code,
          name: p.name,
          legal_name: p.legal_name,
          type: p.type,
          roles: p.roles,
          tax_number: p.tax_number,
          is_active: p.is_active,
          reasons,
          similarity: reasons.includes('name') ? 0.5 : 0,
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
      const key = request.headers.get('Idempotency-Key') ?? ''
      const raw = await request.text()
      const stored = db.idempotency.get(key)
      if (stored) {
        if (stored.body !== raw) {
          return fail(422, 'IDEMPOTENCY_KEY_REUSED', 'Anahtar farklı bir istekle kullanıldı.')
        }
        return HttpResponse.json({ data: stored.party }, { status: 201 })
      }
      const sent = JSON.parse(raw) as Record<string, unknown>
      const input = sent as unknown as PartyInput
      if (sent.code !== undefined) return validation({ code: ['Kod sunucu tarafından verilir.'] })
      if (sent.version !== undefined)
        return validation({ version: ['Oluştururken sürüm gönderilmez.'] })
      const party = makeParty({ ...input, code: `P${String(db.nextCode).padStart(6, '0')}` })
      const fields = validateParty(db, party)
      if (Object.keys(fields).length) return validation(fields)
      db.nextCode += 1
      db.parties.push(party)
      db.idempotency.set(key, { body: raw, party })
      if (db.dropNextCreateResponse) {
        db.dropNextCreateResponse = false
        return HttpResponse.error()
      }
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
      if (db.failPatchIds.has(party.id)) return fail(500, 'SERVER_ERROR', 'Sunucu hatası.')
      const patch = (await request.json()) as Partial<Party> & { version?: number }
      if (typeof patch.version !== 'number') return validation({ version: ['Sürüm zorunludur.'] })
      if ('code' in patch) return validation({ code: ['Kod değiştirilemez.'] })
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
      const party = find(id)
      if (!party) return fail(404, 'NOT_FOUND', 'Bulunamadı.')
      const conflict = versionCheck(request, party.version)
      if (conflict) return conflict
      if (db.inUseIds.has(id)) {
        Object.assign(party, { is_active: false, version: party.version + 1 })
        return HttpResponse.json({
          data: party,
          meta: { action: 'deactivated', message: 'Cari kullanımda olduğu için pasifleştirildi.' },
        })
      }
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
      if (body.version !== undefined)
        return validation({ version: ['Oluştururken sürüm gönderilmez.'] })
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
      if (typeof body.version !== 'number') return validation({ version: ['Sürüm zorunludur.'] })
      if (body.version !== row.version) {
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
      const row = (db[sub] as SubRow[]).find((r) => r.id === String(params.rowId))
      if (!row) return fail(404, 'NOT_FOUND', 'Bulunamadı.')
      const conflict = versionCheck(request, row.version)
      if (conflict) return conflict
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

/** DELETE carries the version the user saw (?version=); 422 without it, 409 when stale. */
function versionCheck(request: Request, current: number) {
  const raw = new URL(request.url).searchParams.get('version')
  if (raw === null || !/^\d+$/.test(raw)) return validation({ version: ['Sürüm zorunludur.'] })
  if (Number(raw) !== current) return fail(409, 'VERSION_CONFLICT', 'Kayıt değiştirildi.')
  return null
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
