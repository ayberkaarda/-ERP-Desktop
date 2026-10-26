import { http, HttpResponse } from 'msw'
import type {
  Account,
  Area,
  Instrument,
  OpenItem,
  Payment,
  Plan,
  Statement,
  Transfer,
  TreasuryRecord,
} from '@/features/treasury/shared/types'
import { AREA_BASE } from '@/features/treasury/shared/types'

export const TREAS_ACCOUNT = '01950000-0000-7000-8000-000000000001'
export const TREAS_PAYMENT = '01950000-0000-7000-8000-000000000002'
export const TREAS_PARTY = '01950000-0000-7000-8000-000000000003'
export const TREAS_STATEMENT = '01950000-0000-7000-8000-000000000004'
export const TREAS_INSTRUMENT = '01950000-0000-7000-8000-000000000005'
export const TREAS_MOVEMENT = '01950000-0000-7000-8000-000000000006'
export const TREAS_INVOICE = '01950000-0000-7000-8000-000000000007'
export interface TreasuryDb {
  records: Record<Area, TreasuryRecord[]>
  calls: {
    method: string
    path: string
    body: Record<string, unknown>
    key: string | null
    company: string | null
  }[]
  failAfterCommit: Record<string, number>
  errors: Record<
    string,
    { status: number; message: string; code?: string; fields?: Record<string, string[]> }
  >
  replays: Map<string, TreasuryRecord>
  openItems: OpenItem[]
}
export function createTreasuryDb(): TreasuryDb {
  const account: Account = {
    id: TREAS_ACCOUNT,
    version: 1,
    type: 'bank',
    code: 'BNK-1',
    name: 'Merkez banka',
    currency_code: 'TRY',
    gl_account_id: 'gl-102',
    bank_name: 'Banka',
    branch: null,
    iban: null,
    is_active: true,
    allow_negative: false,
    balance: '1000.0000',
    has_movements: false,
  }
  const payment: Payment = {
    id: TREAS_PAYMENT,
    version: 1,
    number: null,
    status: 'draft',
    direction: 'receipt',
    account_id: TREAS_ACCOUNT,
    party_id: TREAS_PARTY,
    party_name: 'Tedarikçi A',
    document_date: '2027-06-15',
    currency_code: 'TRY',
    fx_rate: '1.000000',
    amount: '100.0000',
    reference: 'PAY-1',
    description: null,
    allocations: [],
    journal_entry_id: null,
  }
  const statement: Statement = {
    id: TREAS_STATEMENT,
    version: 1,
    status: 'imported',
    account_id: TREAS_ACCOUNT,
    format: 'csv',
    bank_reference: 'ST-1',
    start_date: '2027-06-01',
    end_date: '2027-06-30',
    opening_balance: '0.0000',
    closing_balance: '100.0000',
    currency_code: 'TRY',
    lines: [
      {
        id: 'line-1',
        line_no: 1,
        date: '2027-06-15',
        value_date: null,
        reference: 'PAY-1',
        description: 'Tahsilat',
        amount: '100.0000',
        movement_id: null,
        payment_id: null,
        matched: false,
      },
    ],
  }
  const instrument: Instrument = {
    id: TREAS_INSTRUMENT,
    version: 1,
    status: 'portfolio',
    kind: 'cheque',
    direction: 'received',
    instrument_number: 'CHK-1',
    party_id: TREAS_PARTY,
    party_name: 'Tedarikçi A',
    amount: '100.0000',
    currency_code: 'TRY',
    fx_rate: '1.000000',
    issue_date: '2027-06-15',
    due_date: '2027-07-15',
    bank_name: 'Banka',
    drawer: null,
    reference: null,
    allocations: [],
    events: [],
  }
  const plan: Plan = {
    id: 'plan-1',
    version: 1,
    status: 'scheduled',
    party_id: TREAS_PARTY,
    direction: 'receipt',
    currency_code: 'TRY',
    amount: '100.0000',
    due_date: '2027-06-30',
    description: 'Plan',
    account_id: TREAS_ACCOUNT,
    payment_id: null,
  }
  const transfer: Transfer = {
    id: 'transfer-1',
    version: 1,
    status: 'draft',
    from_account_id: TREAS_ACCOUNT,
    to_account_id: 'account-2',
    document_date: '2027-06-15',
    amount: '100.0000',
    target_amount: '100.0000',
    source_fx_rate: '1',
    target_fx_rate: '1',
    fee_amount: '0',
    expense_account_id: null,
  }
  return {
    records: {
      accounts: [account],
      payments: [payment],
      transfers: [transfer],
      instruments: [instrument],
      banking: [statement],
      plans: [plan],
    },
    calls: [],
    failAfterCommit: {},
    errors: {},
    replays: new Map(),
    openItems: [
      {
        id: TREAS_INVOICE,
        module: 'sales',
        number: 'INV-1',
        invoice_type: 'sale',
        status: 'issued',
        party_id: TREAS_PARTY,
        party_name: 'Tedarikçi A',
        document_date: '2027-06-01',
        due_date: '2027-06-30',
        currency_code: 'TRY',
        fx_rate: '1.000000',
        total: '100.0000',
        historical_local: '100.0000',
        paid_amount: '0.0000',
        balance_due: '100.0000',
      },
    ],
  }
}
const envelope = (data: unknown) => HttpResponse.json({ data })
function validAllocations(area: Area, body: Record<string, unknown>) {
  const allowed =
    area === 'instruments'
      ? ['invoice_module', 'invoice_id', 'amount']
      : ['invoice_module', 'invoice_id', 'amount', 'fx_rate']
  return (
    !Array.isArray(body.allocations) ||
    body.allocations.every(
      (line: unknown) =>
        typeof line === 'object' &&
        line !== null &&
        Object.keys(line).every((key) => allowed.includes(key)),
    )
  )
}
const page = (data: unknown[], request?: Request) => {
  const params = request ? new URL(request.url).searchParams : new URLSearchParams()
  const current = Number(params.get('page') ?? 1)
  const size = Number(params.get('per_page') ?? 100)
  return HttpResponse.json({
    data: data.slice((current - 1) * size, current * size),
    meta: {
      pagination: {
        current_page: current,
        last_page: Math.max(1, Math.ceil(data.length / size)),
        total: data.length,
        per_page: size,
      },
    },
  })
}
export function treasuryHandlers(db: TreasuryDb) {
  return [
    http.get('*/api/v1/treasury-open-items', ({ request }) => {
      const u = new URL(request.url)
      return page(
        db.openItems.filter(
          (i) =>
            i.module === u.searchParams.get('module') &&
            i.party_id === u.searchParams.get('party_id'),
        ),
        request,
      )
    }),
    http.get('*/api/v1/treasury-payments/:id/preview', () =>
      envelope({
        currency: 'TRY',
        amount_local: '100.0000',
        allocated_local: '0.0000',
        advance_local: '100.0000',
        realized_fx: '0.0000',
        lines: [
          { account_id: '102', debit: '100.00', credit: '0.00' },
          { account_id: '120', debit: '0.00', credit: '100.00' },
        ],
      }),
    ),
    http.get('*/api/v1/treasury-accounts/:id/movements', () => page([])),
    http.get('*/api/v1/treasury-bank-statements/:id/suggestions', ({ request }) =>
      page(
        [
          {
            id: TREAS_MOVEMENT,
            movement_id: TREAS_MOVEMENT,
            payment_id: TREAS_PAYMENT,
            account_id: TREAS_ACCOUNT,
            direction: 'receipt',
            amount: '100.0000',
            currency_code: 'TRY',
            document_date: '2027-06-15',
            reference: 'PAY-1',
            source_type: 'treasury_payment',
          },
        ],
        request,
      ),
    ),
    http.post('*/api/v1/treasury-bank-statements/preview', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      db.calls.push({
        method: 'POST',
        path: '/treasury-bank-statements/preview',
        body,
        key: request.headers.get('Idempotency-Key'),
        company: request.headers.get('X-Company-Id'),
      })
      if (!['comma', 'semicolon', 'tab'].includes(String(body.delimiter)))
        return HttpResponse.json({ errors: { message: 'Invalid delimiter' } }, { status: 422 })
      return envelope(db.records.banking[0])
    }),
    http.get('*/api/v1/treasury-reports/:slug', () =>
      HttpResponse.json({
        data: [{ currency_code: 'TRY', amount: '100.0000' }],
        meta: {
          currency: 'TRY',
          pagination: { current_page: 1, last_page: 1, total: 1, per_page: 100 },
        },
      }),
    ),
    ...Object.entries(AREA_BASE).flatMap(([area, base]) => {
      const key = area as Area
      return [
        http.get(`*/api/v1${base}`, ({ request }) => {
          const params = new URL(request.url).searchParams
          const q = params.get('q')?.toLowerCase()
          return page(
            db.records[key].filter(
              (r) =>
                (!q || JSON.stringify(r).toLowerCase().includes(q)) &&
                ['status', 'party_id', 'direction', 'currency_code', 'account_id'].every(
                  (field) => {
                    const filter = params.get(
                      (key === 'banking' || key === 'instruments') && field === 'status'
                        ? 'status'
                        : 'filter[' + field + ']',
                    )
                    return !filter || (r as unknown as Record<string, unknown>)[field] === filter
                  },
                ),
            ),
            request,
          )
        }),
        http.get(`*/api/v1${base}/:id`, ({ params }) => {
          const record = db.records[key].find((r) => r.id === params.id)
          return record
            ? envelope(record)
            : HttpResponse.json(
                { errors: { message: 'Not found', code: 'NOT_FOUND' } },
                { status: 404 },
              )
        }),
        http.post(`*/api/v1${base}/:id/:action`, async ({ request, params }) => {
          const body = (await request.json()) as Record<string, unknown>
          const path = `${base}/${String(params.id)}/${String(params.action)}`
          const idempotency = request.headers.get('Idempotency-Key')
          db.calls.push({
            method: 'POST',
            path,
            body,
            key: idempotency,
            company: request.headers.get('X-Company-Id'),
          })
          const error = db.errors[path]
          if (error)
            return HttpResponse.json(
              {
                errors: {
                  message: error.message,
                  code: error.code ?? 'VALIDATION_ERROR',
                  fields: error.fields ?? {},
                },
              },
              { status: error.status },
            )
          const replayKey = `${path}:${idempotency}`
          if (db.replays.has(replayKey)) return envelope(db.replays.get(replayKey))
          const record = db.records[key].find((r) => r.id === params.id)
          if (!record)
            return HttpResponse.json(
              { errors: { message: 'Not found', code: 'NOT_FOUND' } },
              { status: 404 },
            )
          if (body.version !== record.version)
            return HttpResponse.json(
              { errors: { message: 'Changed', code: 'VERSION_CONFLICT' } },
              { status: 409 },
            )
          const action = String(params.action)
          if (!validAllocations(key, body))
            return HttpResponse.json(
              { errors: { message: 'Unknown allocation field', code: 'VALIDATION_ERROR' } },
              { status: 422 },
            )
          if (action === 'reverse' && key !== 'instruments' && typeof body.date !== 'string') {
            return HttpResponse.json(
              {
                errors: {
                  message: 'Reversal date is required',
                  code: 'VALIDATION_ERROR',
                  fields: { date: ['Required'] },
                },
              },
              { status: 422 },
            )
          }
          if (key === 'banking') {
            const s = record as Statement
            if (action === 'match' || action === 'unmatch') {
              const l = s.lines.find((l) => l.id === body.line_id)
              if (l) {
                l.movement_id = action === 'match' ? String(body.movement_id) : null
                l.matched = action === 'match'
              }
            }
            if (action === 'reconcile') s.status = 'reconciled'
            if (action === 'reopen') s.status = 'imported'
          } else if (action === 'post') {
            record.status = 'posted'
            record.number = 'PAY20270001'
            record.journal_entry_id = 'journal-1'
          } else if (action === 'reverse') record.status = 'reversed'
          else if (action === 'submit') record.status = 'approved'
          else if (action === 'cancel') record.status = 'cancelled'
          else if (action === 'clear') record.status = 'cleared'
          else if (action === 'receive') record.status = 'portfolio'
          else if (action === 'issue') record.status = 'issued'
          else if (action === 'fulfil') record.status = 'fulfilled'
          record.version++
          const result = structuredClone(record)
          db.replays.set(replayKey, result)
          if ((db.failAfterCommit[path] ?? 0) > 0) {
            db.failAfterCommit[path] = (db.failAfterCommit[path] ?? 1) - 1
            return HttpResponse.error()
          }
          return envelope(result)
        }),
        http.post(`*/api/v1${base}`, async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          if (!validAllocations(key, body))
            return HttpResponse.json(
              { errors: { message: 'Unknown allocation field', code: 'VALIDATION_ERROR' } },
              { status: 422 },
            )
          const idempotency = request.headers.get('Idempotency-Key')
          db.calls.push({
            method: 'POST',
            path: base,
            body,
            key: idempotency,
            company: request.headers.get('X-Company-Id'),
          })
          const record = {
            ...body,
            id: `created-${key}`,
            version: 1,
            status: key === 'banking' ? 'imported' : key === 'plans' ? 'scheduled' : 'draft',
            ...(key === 'banking' ? { lines: (db.records.banking[0] as Statement).lines } : {}),
          } as TreasuryRecord
          db.records[key].push(record)
          return HttpResponse.json({ data: record }, { status: 201 })
        }),
        http.patch(`*/api/v1${base}/:id`, async ({ request, params }) => {
          const body = (await request.json()) as Record<string, unknown>
          db.calls.push({
            method: 'PATCH',
            path: `${base}/${String(params.id)}`,
            body,
            key: null,
            company: request.headers.get('X-Company-Id'),
          })
          if (!validAllocations(key, body))
            return HttpResponse.json(
              { errors: { message: 'Unknown allocation field', code: 'VALIDATION_ERROR' } },
              { status: 422 },
            )
          const record = db.records[key].find((r) => r.id === params.id)
          if (!record)
            return HttpResponse.json(
              { errors: { message: 'Not found', code: 'NOT_FOUND' } },
              { status: 404 },
            )
          Object.assign(record, body, { version: record.version + 1 })
          return envelope(record)
        }),
      ]
    }),
  ]
}
