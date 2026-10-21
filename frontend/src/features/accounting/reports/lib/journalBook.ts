import Decimal from 'decimal.js'
import { amountOf } from '../../journal/lib/balance'
import type { JournalBookEntry, JournalBookLine } from '../types'

export type BookRow =
  | { kind: 'entry'; entry: JournalBookEntry }
  | { kind: 'line'; entry: JournalBookEntry; line: JournalBookLine }

export interface BookTotals {
  debit: string
  credit: string
}

export interface BookPage {
  number: number
  rows: BookRow[]
  /** "Devreden": cumulative totals brought from the previous page. */
  broughtForward: BookTotals
  pageTotals: BookTotals
  /** "Nakledilen": cumulative totals carried to the next page. */
  carriedForward: BookTotals
}

export const BOOK_PAGE_SIZES = [20, 30, 40, 50] as const
export const DEFAULT_BOOK_PAGE_SIZE = 30
export const MIN_BOOK_PAGE_SIZE = 10
export const MAX_BOOK_PAGE_SIZE = 100

/**
 * Rows per printed page from untrusted input (URL, saved preset): a whole number inside
 * [MIN, MAX]; anything else ("Infinity", "-5", "abc", "1e9") falls back to the default.
 */
export function parseBookPageSize(value: unknown): number {
  const text =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!/^\d{1,3}$/.test(text)) return DEFAULT_BOOK_PAGE_SIZE
  const n = Number(text)
  return n >= MIN_BOOK_PAGE_SIZE && n <= MAX_BOOK_PAGE_SIZE ? n : DEFAULT_BOOK_PAGE_SIZE
}

const fixed = (d: Decimal) => d.toFixed(2)

/**
 * Splits the yevmiye defteri into printed pages of `rowsPerPage` rows (entry headers and lines
 * each take a row). An entry header never ends a page alone, and every page carries the
 * running totals forward from the opening amounts.
 */
export function paginateBook(
  entries: readonly JournalBookEntry[],
  rowsPerPage: number,
  opening: BookTotals = { debit: '0', credit: '0' },
): BookPage[] {
  const size = Number.isFinite(rowsPerPage)
    ? Math.min(MAX_BOOK_PAGE_SIZE, Math.max(2, Math.trunc(rowsPerPage)))
    : DEFAULT_BOOK_PAGE_SIZE
  const rows: BookRow[] = []
  for (const entry of entries) {
    rows.push({ kind: 'entry', entry })
    for (const line of [...entry.lines].sort((a, b) => a.line_no - b.line_no))
      rows.push({ kind: 'line', entry, line })
  }
  const pages: BookPage[] = []
  let debit = amountOf(opening.debit)
  let credit = amountOf(opening.credit)
  let current: BookRow[] = []
  let pageDebit = new Decimal(0)
  let pageCredit = new Decimal(0)
  let brought = { debit, credit }

  const close = () => {
    pages.push({
      number: pages.length + 1,
      rows: current,
      broughtForward: { debit: fixed(brought.debit), credit: fixed(brought.credit) },
      pageTotals: { debit: fixed(pageDebit), credit: fixed(pageCredit) },
      carriedForward: { debit: fixed(debit), credit: fixed(credit) },
    })
    current = []
    pageDebit = new Decimal(0)
    pageCredit = new Decimal(0)
    brought = { debit, credit }
  }

  rows.forEach((row, i) => {
    const next = rows[i + 1]
    const orphan = row.kind === 'entry' && current.length === size - 1 && next?.kind === 'line'
    if (current.length >= size || (orphan && current.length > 0)) close()
    current.push(row)
    if (row.kind === 'line') {
      const d = amountOf(row.line.debit)
      const c = amountOf(row.line.credit)
      pageDebit = pageDebit.plus(d)
      pageCredit = pageCredit.plus(c)
      debit = debit.plus(d)
      credit = credit.plus(c)
    }
  })
  if (current.length > 0 || pages.length === 0) close()
  return pages
}
