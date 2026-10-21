import Decimal from 'decimal.js'
import { ApiError, platform } from '@/platform'
import type { Envelope } from '../journal/types'
import type {
  DebitCredit,
  GeneralLedgerPage,
  JournalBookEntry,
  JournalBookPage,
  TrialBalance,
} from './types'

const http = () => platform.http

export type ReportParams = Record<string, string | number>

export const REPORT_PATHS = {
  trialBalance: '/reports/trial-balance',
  generalLedger: '/reports/general-ledger',
  journalBook: '/reports/journal-book',
} as const

export const BOOK_TOO_LARGE = 'BOOK_TOO_LARGE'
/** Entries were booked while the book was being read page by page: its totals do not chain. */
export const BOOK_CHANGED = 'BOOK_CHANGED'

/** Server maximum for per_page on the reports. */
export const REPORT_MAX_PER_PAGE = 500

const same = (a: DebitCredit, b: DebitCredit) =>
  new Decimal(a.debit).eq(b.debit) && new Decimal(a.credit).eq(b.credit)

export interface JournalBookResult {
  entries: JournalBookEntry[]
  /** "Devreden" of the first page (entries of the fiscal year before the range). */
  carriedForward: DebitCredit
  /** "Nakledilen" after the last entry, as the server computed it. */
  closing: DebitCredit
}

export const reportsApi = {
  trialBalance: (params: ReportParams, signal?: AbortSignal) =>
    http()
      .get<Envelope<TrialBalance>>(REPORT_PATHS.trialBalance, { params, signal })
      .then((r) => r.data),
  generalLedger: (params: ReportParams, page: number, signal?: AbortSignal) =>
    http().get<GeneralLedgerPage>(REPORT_PATHS.generalLedger, {
      params: { ...params, page, per_page: 100 },
      signal,
    }),
  /**
   * The whole book for the range (pages of 500 entries), so printed page numbers and
   * carry-forward totals are right. Each server page's devreden must equal the previous page's
   * nakledilen; otherwise the book changed while it was read. Above `maxPages` pages the
   * export is the way to go.
   */
  journalBook: async (
    params: ReportParams,
    signal?: AbortSignal,
    maxPages = 10,
  ): Promise<JournalBookResult> => {
    const entries: JournalBookEntry[] = []
    let opening: DebitCredit = { debit: '0', credit: '0' }
    let carried: DebitCredit = opening
    for (let page = 1; ; page++) {
      const res = await http().get<JournalBookPage>(REPORT_PATHS.journalBook, {
        params: { ...params, page, per_page: REPORT_MAX_PER_PAGE },
        signal,
      })
      const { pagination } = res.meta
      if (pagination.last_page > maxPages) {
        throw new ApiError(
          0,
          BOOK_TOO_LARGE,
          `More than ${maxPages * REPORT_MAX_PER_PAGE} entries.`,
        )
      }
      if (page === 1) opening = res.meta.page_brought_forward
      else if (!same(carried, res.meta.page_brought_forward)) {
        throw new ApiError(0, BOOK_CHANGED, 'The journal book changed while it was loaded.')
      }
      carried = res.meta.page_carried_forward
      entries.push(...res.data)
      if (page >= pagination.last_page || res.data.length === 0) break
    }
    return { entries, carriedForward: opening, closing: carried }
  },
}
