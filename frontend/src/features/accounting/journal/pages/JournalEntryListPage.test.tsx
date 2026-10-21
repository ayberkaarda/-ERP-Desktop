import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ACC_CASH, ENTRY_POSTED } from '@/test/handlers/accounting2'
import { renderAccounting2, setupAccounting2 } from '../testing'
import './JournalEntryListPage'

// Keyboard-driven flows through the real router are slow on a cold run.
vi.setConfig({ testTimeout: 15_000 })

describe('journal entry list', () => {
  beforeEach(() => window.localStorage.clear())

  it('lists entries with status badges and opens one', async () => {
    setupAccounting2()
    const user = userEvent.setup()
    const { router } = renderAccounting2('/accounting/journal-entries')
    const grid = await screen.findByRole('grid', { name: 'Yevmiye fişleri' })
    expect(await within(grid).findByText('2026/000001')).toBeInTheDocument()
    expect(within(grid).getByText('Kesinleşti')).toBeInTheDocument()
    expect(within(grid).getAllByText('Taslak').length).toBeGreaterThan(0)
    expect(within(grid).getAllByText('1.200,00').length).toBe(2)

    await user.click(within(grid).getByRole('link', { name: '2026/000001' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/accounting/journal-entries/${ENTRY_POSTED}`),
    )
  })

  it('filters by date range, account and amount from the URL and keeps them in saved views', async () => {
    const db = setupAccounting2()
    const user = userEvent.setup()
    renderAccounting2(
      `/accounting/journal-entries?filter[date_from]=2026-01-15&filter[account_id]=${ACC_CASH}&filter[amount_min]=500`,
    )
    const grid = await screen.findByRole('grid', { name: 'Yevmiye fişleri' })
    await waitFor(() => expect(within(grid).getByText('Kira tahakkuku')).toBeInTheDocument())
    expect(within(grid).queryByText('Peşin satış')).not.toBeInTheDocument()
    const list = db.calls.filter((c) => c.method === 'GET' && c.path === '/journal-entries').at(-1)
    expect(list?.url.searchParams.get('filter[date_from]')).toBe('2026-01-15')
    expect(list?.url.searchParams.get('filter[account_id]')).toBe(ACC_CASH)
    expect(list?.url.searchParams.get('filter[amount_min]')).toBe('500')
    // The account filter shows the account's label, loaded by id.
    expect(await screen.findByDisplayValue('100 · Kasa')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Kayıtlı görünümler' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Geçerli ayarları kaydet…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ayarları kaydet' })
    await user.type(within(dialog).getByLabelText(/^Ad/), 'Kasa ocak')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    const stored = JSON.parse(
      window.localStorage.getItem('keystone.presets.accounting.journal-entries') ?? '[]',
    ) as { name: string; params: Record<string, string> }[]
    expect(stored[0]).toEqual({
      name: 'Kasa ocak',
      params: { date_from: '2026-01-15', account_id: ACC_CASH, amount_min: '500' },
    })

    await user.click(screen.getByRole('button', { name: 'Tüm filtreleri temizle' }))
    await waitFor(() => expect(within(grid).getByText('Peşin satış')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Kayıtlı görünümler' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Kasa ocak' }))
    await waitFor(() => expect(within(grid).queryByText('Peşin satış')).not.toBeInTheDocument())
  })

  it('hides creating without permission', async () => {
    setupAccounting2({ permissions: ['accounting.entries.view'] })
    renderAccounting2('/accounting/journal-entries')
    await screen.findByRole('grid', { name: 'Yevmiye fişleri' })
    expect(screen.queryByRole('link', { name: 'Yeni fiş' })).not.toBeInTheDocument()
  })
})
