import type { JournalBookEntry } from '../types'
import { paginateBook } from './journalBook'

const entry = (n: number, amounts: string[]): JournalBookEntry => ({
  id: `e${n}`,
  number: `2026/${String(n).padStart(6, '0')}`,
  entry_date: '2026-01-10',
  entry_type: 'general',
  status: 'posted',
  description: null,
  total_debit: '0',
  total_credit: '0',
  lines: amounts.flatMap((a, i) => [
    {
      line_no: i * 2 + 1,
      account_id: 'a100',
      account_code: '100',
      account_name: 'Kasa',
      description: null,
      debit: a,
      credit: '0',
      party_id: null,
    },
    {
      line_no: i * 2 + 2,
      account_id: 'a600',
      account_code: '600',
      account_name: 'Satış',
      description: null,
      debit: '0',
      credit: a,
      party_id: null,
    },
  ]),
})

describe('journal book pages', () => {
  it('carries totals forward page by page (devreden / nakledilen)', () => {
    // Rows: e1 l l | e2 l l l | l
    const pages = paginateBook([entry(1, ['100.10']), entry(2, ['0.20', '0.30'])], 4, {
      debit: '1000',
      credit: '1000',
    })
    expect(pages.map((p) => p.rows.length)).toEqual([3, 4, 1])
    expect(pages[0]?.broughtForward).toEqual({ debit: '1000.00', credit: '1000.00' })
    expect(pages[0]?.pageTotals).toEqual({ debit: '100.10', credit: '100.10' })
    expect(pages[0]?.carriedForward).toEqual({ debit: '1100.10', credit: '1100.10' })
    expect(pages[1]?.broughtForward).toEqual(pages[0]?.carriedForward)
    expect(pages.at(-1)?.carriedForward).toEqual({ debit: '1100.60', credit: '1100.60' })
  })

  it('never leaves an entry header alone at the bottom of a page', () => {
    const pages = paginateBook([entry(1, ['1']), entry(2, ['2'])], 4)
    expect(pages[0]?.rows.map((r) => r.kind)).toEqual(['entry', 'line', 'line'])
    expect(pages[1]?.rows[0]?.kind).toBe('entry')
  })

  it('returns one empty page for an empty book', () => {
    expect(paginateBook([], 30)).toHaveLength(1)
  })
})
