import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ACC_CASH, ENTRY_POSTED, PERIOD_JAN } from '@/test/handlers/accounting2'
import type { JournalEntry } from '../../journal/types'
import { renderAccounting2, setupAccounting2 } from '../../journal/testing'
import './TrialBalancePage'
import './GeneralLedgerPage'
import './JournalBookPage'

/** A posted bank transfer so the bank parent account has children with movements. */
function bankEntry(): JournalEntry {
  return {
    id: 'je-bank',
    number: '2026/000002',
    entry_type: 'general',
    entry_date: '2026-01-15',
    period_id: PERIOD_JAN,
    description: 'Bankaya yatan',
    status: 'posted',
    source_type: null,
    source_id: null,
    reverses_id: null,
    reversed_by_id: null,
    total_debit: '500.0000',
    total_credit: '500.0000',
    posted_at: '2026-01-15T10:00:00Z',
    version: 1,
    lines: [
      {
        id: 'jb-1',
        line_no: 1,
        account_id: 'acc-102-01',
        account: null,
        debit: '500.0000',
        credit: '0.0000',
        currency_code: null,
        fx_amount: null,
        fx_rate: null,
        party_id: null,
        cost_center_id: null,
        project_id: null,
        description: null,
        due_date: null,
        document_ref: null,
      },
      {
        id: 'jb-2',
        line_no: 2,
        account_id: ACC_CASH,
        account: null,
        debit: '0.0000',
        credit: '500.0000',
        currency_code: null,
        fx_amount: null,
        fx_rate: null,
        party_id: null,
        cost_center_id: null,
        project_id: null,
        description: 'Kasadan bankaya',
        due_date: null,
        document_ref: null,
      },
    ],
  }
}

// Keyboard-driven flows through the real router are slow on a cold run.
vi.setConfig({ testTimeout: 15_000 })

describe('trial balance', () => {
  beforeEach(() => window.localStorage.clear())

  it('runs by period, shows the tree with totals check and collapses levels', async () => {
    const db = setupAccounting2()
    db.entries.push(bankEntry())
    const user = userEvent.setup()
    renderAccounting2('/accounting/reports/trial-balance')
    expect(await screen.findByText('Parametreleri seçip raporu getirin.')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Muhasebe dönemi' }))
    const period = await screen.findByLabelText(/^Dönem/)
    await waitFor(() => expect(within(period).getAllByRole('option').length).toBeGreaterThan(1))
    await user.selectOptions(period, PERIOD_JAN)
    await user.click(screen.getByRole('checkbox', { name: 'Önceki yılla karşılaştır' }))
    await user.click(screen.getByRole('button', { name: 'Raporu getir' }))

    const table = await screen.findByRole('table', { name: 'Mizan' })
    const call = db.calls.filter((c) => c.path === '/reports/trial-balance').at(-1)
    expect(call?.url.searchParams.get('period_id')).toBe(PERIOD_JAN)
    expect(call?.url.searchParams.get('compare_with_previous_year')).toBe('1')
    expect(call?.url.searchParams.get('level')).toBe('3')
    expect(screen.getByRole('status')).toHaveTextContent('Borç = Alacak')
    expect(within(table).getByText('Akbank TL')).toBeInTheDocument()
    expect(
      within(table).getByRole('columnheader', { name: 'Önceki yıl bakiye' }),
    ).toBeInTheDocument()

    const toggle = within(table).getByRole('button', { name: '102 alt hesaplarını kapat' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    expect(within(table).queryByText('Akbank TL')).not.toBeInTheDocument()
    expect(
      within(table).getByRole('button', { name: '102 alt hesaplarını aç' }),
    ).toBeInTheDocument()

    // Kasa: 1.200 debit - 500 credit; the code links to its ledger.
    const cashRow = within(table).getByText('Kasa').closest('tr')
    expect(cashRow).toHaveTextContent('1.200,00')
    expect(cashRow).toHaveTextContent('700,00')
    expect(within(table).getByRole('link', { name: '100' })).toHaveAttribute(
      'href',
      `/accounting/reports/general-ledger?account_id=${ACC_CASH}&date_from=2026-01-01&date_to=2026-01-31`,
    )
  })

  it('flags an unbalanced result', async () => {
    const db = setupAccounting2()
    const posted = db.entries.find((e) => e.id === ENTRY_POSTED)
    posted?.lines.pop()
    renderAccounting2(
      '/accounting/reports/trial-balance?mode=range&date_from=2026-01-01&date_to=2026-01-31',
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Mizan tutmuyor · hareket farkı 200,00 · bakiye farkı 200,00',
    )
  })
})

describe('general ledger', () => {
  it('shows the opening balance, running balance and drills through to the entry', async () => {
    const db = setupAccounting2()
    db.entries.push(bankEntry())
    renderAccounting2(
      `/accounting/reports/general-ledger?account_id=${ACC_CASH}&date_from=2026-01-12&date_to=2026-01-31`,
    )
    const table = await screen.findByRole('table', { name: 'Büyük defter' })
    expect(await within(table).findByTestId('opening-balance')).toHaveTextContent('1.200,00 B')
    const row = within(table)
      .getByText(/Kasadan bankaya/)
      .closest('tr')
    expect(row).toHaveTextContent('500,00')
    expect(row).toHaveTextContent('700,00 B')
    expect(within(table).getByTestId('closing-balance')).toHaveTextContent('700,00 B')
    expect(within(table).getByRole('link', { name: '2026/000002' })).toHaveAttribute(
      'href',
      '/accounting/journal-entries/je-bank',
    )
  })

  it('virtualizes long ledgers and pages through them', async () => {
    // jsdom has no layout; give the scroller a viewport so the virtualizer has a window to fill.
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
    const db = setupAccounting2()
    for (let i = 0; i < 260; i++) {
      const e = bankEntry()
      db.entries.push({
        ...e,
        id: `je-bulk-${i}`,
        number: `2026/1${String(i).padStart(5, '0')}`,
        lines: e.lines.map((l) => ({ ...l, id: `${l.id}-${i}` })),
      })
    }
    const user = userEvent.setup()
    renderAccounting2(
      `/accounting/reports/general-ledger?account_id=${ACC_CASH}&date_from=2026-01-01&date_to=2026-01-31`,
    )
    const more = await screen.findByRole('button', { name: /Daha fazla yükle \(100 \/ 261\)/ })
    await user.click(more)
    await user.click(await screen.findByRole('button', { name: /Daha fazla yükle \(200 \/ 261\)/ }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Daha fazla yükle/ })).not.toBeInTheDocument(),
    )
    const table = screen.getByRole('table', { name: 'Büyük defter' })
    // Only a window of the 261 rows is in the DOM.
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBeLessThan(120))
    height.mockRestore()
    width.mockRestore()
    expect(within(table).getByTestId('closing-balance')).toHaveTextContent('128.800,00 A')
  })
})

describe('journal book', () => {
  it('lays out pages with brought / carried forward totals and exports', async () => {
    const db = setupAccounting2({
      db: { bookCarriedForward: { debit: '100.0000', credit: '100.0000' } },
    })
    db.entries.push(bankEntry())
    const user = userEvent.setup()
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderAccounting2(
      '/accounting/reports/journal-book?mode=range&date_from=2026-01-01&date_to=2026-01-31&page_size=20',
    )
    const page1 = await screen.findByRole('region', { name: 'Sayfa 1 / 1' })
    expect(within(page1).getByTestId('brought-1')).toHaveTextContent('100,00')
    expect(within(page1).getByTestId('page-total-1')).toHaveTextContent('1.700,00')
    expect(within(page1).getByTestId('carried-1')).toHaveTextContent('Genel toplam')
    expect(within(page1).getByTestId('carried-1')).toHaveTextContent('1.800,00')

    await user.selectOptions(screen.getByLabelText('Sayfa başına satır'), '20')
    await user.click(screen.getByRole('button', { name: 'Excel' }))
    await waitFor(() =>
      expect(db.calls.some((c) => c.path === '/reports/journal-book/export')).toBe(true),
    )
    const exp = db.calls.find((c) => c.path === '/reports/journal-book/export')
    expect(exp?.url.searchParams.get('format')).toBe('xlsx')
    expect(exp?.url.searchParams.get('date_from')).toBe('2026-01-01')
    click.mockRestore()
  })

  it('needs the reports permission', async () => {
    setupAccounting2({ permissions: ['accounting.entries.view'] })
    renderAccounting2('/accounting/reports/journal-book')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()
  })
})
