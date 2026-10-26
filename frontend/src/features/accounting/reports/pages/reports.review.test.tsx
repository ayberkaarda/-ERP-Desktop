/// <reference types="node" />
// CSS is not processed in tests (css: false), so the print stylesheet is read as a file.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { ACC_CASH } from '@/test/handlers/accounting2'
import { server } from '@/test/msw/server'
import { renderAccounting2, setupAccounting2 } from '../../journal/testing'
import { parseBookPageSize, paginateBook } from '../lib/journalBook'
import { readFileSync } from 'node:fs'
import './GeneralLedgerPage'
import './JournalBookPage'
import './TrialBalancePage'

vi.setConfig({ testTimeout: 15_000 })

// Vitest runs from the frontend package root.
const printCss = readFileSync(`${process.cwd()}/src/features/accounting/reports/print.css`, 'utf8')

describe('journal book page size', () => {
  it.each([
    ['Infinity', 30],
    ['-5', 30],
    ['abc', 30],
    ['1e9', 30],
    ['5', 30],
    ['250', 30],
    ['40', 40],
    ['100', 100],
  ])('parses %j as %d', (value, expected) => {
    expect(parseBookPageSize(value)).toBe(expected)
  })

  it('never builds one endless page', () => {
    expect(paginateBook([], Number.POSITIVE_INFINITY)).toHaveLength(1)
  })

  it('ignores an unsafe page size from the URL', async () => {
    setupAccounting2()
    renderAccounting2(
      '/accounting/reports/journal-book?mode=range&date_from=2026-01-01&date_to=2026-01-31&page_size=Infinity',
    )
    await screen.findByRole('region', { name: /^Sayfa 1/ })
    expect(screen.getByLabelText('Sayfa başına satır')).toHaveValue('30')
  })
})

describe('journal book printing', () => {
  it('marks the document for print styles while mounted', async () => {
    setupAccounting2()
    const { unmount } = renderAccounting2(
      '/accounting/reports/journal-book?mode=range&date_from=2026-01-01&date_to=2026-01-31',
    )
    const page = await screen.findByRole('region', { name: /^Sayfa 1/ })
    expect(document.documentElement).toHaveAttribute('data-print-book')
    expect(page).toHaveClass('journal-book-page')
    expect(page.closest('#journal-book-print')).not.toBeNull()
    unmount()
    expect(document.documentElement).not.toHaveAttribute('data-print-book')
  })

  it('lets the shell flow, hides it and breaks pages in print', () => {
    const print = /@media print\s*{([\s\S]*)}\s*$/.exec(printCss.trim())?.[1] ?? ''
    expect(print).toMatch(/overflow:\s*visible\s*!important/)
    expect(print).toMatch(/height:\s*auto\s*!important/)
    expect(print).toMatch(/body\s*{\s*visibility:\s*hidden/)
    expect(print).toMatch(/#journal-book-print\s*{[^}]*visibility:\s*visible/)
    expect(print).toMatch(/\.journal-book-page\s*{[^}]*break-after:\s*page/)
  })
})

describe('general ledger grid semantics', () => {
  it('numbers rows for assistive tech, including virtualized ones', async () => {
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    const db = setupAccounting2()
    const posted = db.entries.find((e) => e.status === 'posted')
    if (!posted) throw new Error('posted entry missing')
    for (let i = 0; i < 250; i++) {
      db.entries.push({
        ...posted,
        id: `je-many-${i}`,
        number: `2026/2${String(i).padStart(5, '0')}`,
        lines: posted.lines.map((l) => ({ ...l, id: `${l.id}-m${i}` })),
      })
    }
    const user = userEvent.setup()
    renderAccounting2(
      `/accounting/reports/general-ledger?account_id=${ACC_CASH}&date_from=2026-01-01&date_to=2026-01-31`,
    )
    const table = await screen.findByRole('table', { name: 'Büyük defter' })
    expect(table).toHaveAttribute('aria-rowcount', '253')
    await user.click(await screen.findByRole('button', { name: /Daha fazla yükle \(100/ }))
    await user.click(await screen.findByRole('button', { name: /Daha fazla yükle \(200/ }))
    await waitFor(() => expect(table).toHaveAttribute('aria-rowcount', '254'))
    const indexed = within(table)
      .getAllByRole('row')
      .map((r) => r.getAttribute('aria-rowindex'))
      .filter((v) => v !== null)
    expect(indexed.slice(0, 3)).toEqual(['1', '2', '3'])
    expect(indexed.at(-1)).toBe('254')
    height.mockRestore()
  })
})

describe('report period picker', () => {
  it('shows a failed period load with a retry', async () => {
    setupAccounting2()
    let fail = true
    server.use(
      http.get('*/api/v1/accounting-periods', () =>
        fail
          ? HttpResponse.json(
              { errors: { message: 'Dönem servisi yanıt vermedi.', code: 'X' } },
              { status: 503 },
            )
          : undefined,
      ),
    )
    const user = userEvent.setup()
    renderAccounting2('/accounting/reports/trial-balance')
    await user.click(await screen.findByRole('radio', { name: 'Muhasebe dönemi' }))
    const alert = await screen.findByRole('alert', {}, { timeout: 10_000 })
    expect(alert).toHaveTextContent('Dönem servisi yanıt vermedi.')
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Tekrar dene' }))
    const period = await screen.findByLabelText(/^Dönem/)
    await waitFor(() => expect(within(period).getAllByRole('option').length).toBeGreaterThan(1))
  })
})
