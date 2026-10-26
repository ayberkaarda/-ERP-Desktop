import { http, HttpResponse } from 'msw'
import {
  ACC_CASH,
  ACC_EXPENSES,
  CC_ADMIN,
  ENTRY_DRAFT,
  ENTRY_POSTED,
  FY_2026,
  PERIOD_JAN,
} from '@/test/handlers/accounting2'
import { server } from '@/test/msw/server'
import { BOOK_CHANGED, reportsApi } from '../../reports/api'
import { setupAccounting2 } from '../testing'
import { journalApi, lookupsApi } from './client'

describe('journal entry lookups', () => {
  it('adds account flags and dimension records to the ids the API sends', async () => {
    const db = setupAccounting2()
    const entry = await journalApi.get(ENTRY_DRAFT)
    const raw = db.calls.find((c) => c.path === `/journal-entries/${ENTRY_DRAFT}`)
    expect(raw).toBeTruthy()
    const expense = entry.lines.find((l) => l.account_id === ACC_EXPENSES)
    expect(expense?.account).toMatchObject({ code: '770', requires_cost_center: true })
    expect(expense?.cost_center).toMatchObject({ id: CC_ADMIN, code: 'GY' })
    expect(entry.lines.find((l) => l.account_id === ACC_CASH)?.party).toBeNull()
    // One lookup per distinct record.
    expect(db.calls.filter((c) => c.path === `/accounts/${ACC_EXPENSES}`)).toHaveLength(1)
  })

  it('falls back to the line code and name when an account cannot be read', async () => {
    setupAccounting2()
    server.use(
      http.get('*/api/v1/accounts/:id', () =>
        HttpResponse.json({ errors: { message: 'Yasak', code: 'FORBIDDEN' } }, { status: 403 }),
      ),
    )
    const entry = await journalApi.get(ENTRY_POSTED)
    expect(entry.lines[0]?.account).toMatchObject({ id: ACC_CASH, code: '100', name: 'Kasa' })
  })

  it('reuses known records instead of looking them up again', async () => {
    const db = setupAccounting2()
    const first = await journalApi.get(ENTRY_DRAFT)
    const before = db.calls.length
    const accounts = new Map(first.lines.map((l) => [l.account_id, l.account ?? null]))
    const known = {
      accounts: new Map(
        [...accounts].filter((e): e is [string, NonNullable<(typeof e)[1]>] => !!e[1]),
      ),
      refs: new Map([
        [`cost-centers:${CC_ADMIN}`, { id: CC_ADMIN, code: 'GY', name: 'Genel yönetim' }],
      ]),
    }
    const saved = await journalApi.update(
      ENTRY_DRAFT,
      {
        entry_type: 'general',
        entry_date: '2026-01-20',
        description: null,
        version: first.version,
        lines: first.lines.map((l) => ({
          account_id: l.account_id,
          debit: l.debit,
          credit: l.credit,
          currency_code: null,
          fx_amount: null,
          fx_rate: null,
          party_id: null,
          cost_center_id: l.cost_center_id,
          project_id: null,
          description: null,
          document_ref: null,
        })),
      },
      known,
    )
    expect(saved.version).toBe(first.version + 1)
    expect(saved.lines[0]?.cost_center?.code).toBe('GY')
    expect(db.calls.slice(before).map((c) => c.method + ' ' + c.path)).toEqual([
      `PATCH /journal-entries/${ENTRY_DRAFT}`,
    ])
  })

  it('labels periods with their fiscal year code', async () => {
    setupAccounting2()
    const periods = await lookupsApi.periods()
    expect(periods[0]).toMatchObject({
      id: PERIOD_JAN,
      fiscal_year_id: FY_2026,
      fiscal_year_code: '2026',
    })
  })
})

describe('journal book loading', () => {
  it('starts from page_brought_forward and chains the pages', async () => {
    const db = setupAccounting2({
      db: { bookCarriedForward: { debit: '100.0000', credit: '100.0000' } },
    })
    const book = await reportsApi.journalBook({ date_from: '2026-01-01', date_to: '2026-01-31' })
    expect(book.carriedForward).toEqual({ debit: '100.0000', credit: '100.0000' })
    expect(book.closing).toEqual({ debit: '1300.0000', credit: '1300.0000' })
    const call = db.calls.find((c) => c.path === '/reports/journal-book')
    expect(call?.url.searchParams.get('per_page')).toBe('500')
  })

  it('refuses a book whose pages do not chain', async () => {
    setupAccounting2()
    server.use(
      http.get('*/api/v1/reports/journal-book', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'))
        const pair = (v: string) => ({ debit: v, credit: v })
        return HttpResponse.json({
          data:
            page === 1
              ? [
                  {
                    id: 'e1',
                    number: '2026/000001',
                    entry_date: '2026-01-10',
                    entry_type: 'general',
                    status: 'posted',
                    description: null,
                    total_debit: '10.0000',
                    total_credit: '10.0000',
                    lines: [],
                  },
                ]
              : [],
          meta: {
            pagination: { current_page: page, per_page: 500, total: 1000, last_page: 2 },
            page_brought_forward: pair(page === 1 ? '0.0000' : '999.0000'),
            page_carried_forward: pair('10.0000'),
          },
        })
      }),
    )
    await expect(
      reportsApi.journalBook({ date_from: '2026-01-01', date_to: '2026-01-31' }),
    ).rejects.toMatchObject({ code: BOOK_CHANGED })
  })
})
