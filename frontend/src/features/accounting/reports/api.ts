import { ApiError, platform } from '@/platform'
import type { Envelope } from '../journal/types'
import type { GeneralLedgerPage, JournalBookEntry, JournalBookPage, TrialBalance } from './types'

const http = () => platform.http

export type ReportParams = Record<string, string | number>

export const REPORT_PATHS = {
  trialBalance: '/reports/trial-balance',
  generalLedger: '/reports/general-ledger',
  journalBook: '/reports/journal-book',
} as const

export const BOOK_TOO_LARGE = 'BOOK_TOO_LARGE'

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
   * The whole book for the range, so printed page numbers and carry-forward totals are right.
   * Above `maxPages` × 100 entries the export is the way to go.
   */
  journalBook: async (params: ReportParams, signal?: AbortSignal, maxPages = 50) => {
    const entries: JournalBookEntry[] = []
    let carried: JournalBookPage['meta']['carried_forward'] = { debit: '0', credit: '0' }
    for (let page = 1; ; page++) {
      const res = await http().get<JournalBookPage>(REPORT_PATHS.journalBook, {
        params: { ...params, page, per_page: 100 },
        signal,
      })
      if (res.meta.pagination.last_page > maxPages) {
        throw new ApiError(0, BOOK_TOO_LARGE, `More than ${maxPages * 100} entries.`)
      }
      if (page === 1) carried = res.meta.carried_forward
      entries.push(...res.data)
      if (page >= res.meta.pagination.last_page || res.data.length === 0) break
    }
    return { entries, carriedForward: carried }
  },
}
