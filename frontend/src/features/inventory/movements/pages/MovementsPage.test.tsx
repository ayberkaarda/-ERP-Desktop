import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { StockMovement } from '@/features/inventory/stock/lib/types'
import { DOC_RECEIPT, JE_RECEIPT, createInventoryStockDb } from '@/test/handlers/inventoryStock'
import { renderInventoryStock, setupInventoryStock } from '../../stock/testing'
import './MovementsPage'

vi.setConfig({ testTimeout: 20_000 })

const listCalls = (db: ReturnType<typeof setupInventoryStock>) =>
  db.calls.filter((c) => c.method === 'GET' && c.path === '/stock-movements')

/** A long ledger: 250 receipts of the first fixture movement. */
function longLedger(): StockMovement[] {
  const [base] = createInventoryStockDb().movements
  if (!base) throw new Error('fixture has no movements')
  return Array.from({ length: 250 }, (_, i) => ({
    ...base,
    id: `mv-long-${i + 1}`,
    seq: i + 1,
    document_number: `GRS-2026-${String(i + 1).padStart(6, '0')}`,
  }))
}

describe('stock movements ledger', () => {
  it('lists movements newest first with signed quantities and document links', async () => {
    setupInventoryStock()
    renderInventoryStock('/inventory/movements')
    const table = await screen.findByRole('table', { name: 'Stok hareketleri' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Transfer girişi')
    expect(rows.at(-1)).toHaveTextContent('GRS-2026-000001')

    const issue = within(table).getByText('CKS-2026-000001').closest('tr') as HTMLElement
    expect(within(issue).getByText('4 çıkış')).toBeInTheDocument()
    const receipt = within(table).getAllByText('GRS-2026-000001')[0]?.closest('tr') as HTMLElement
    expect(
      within(receipt).getByRole('link', { name: 'GRS-2026-000001 belgesini aç' }),
    ).toHaveAttribute('href', `/inventory/documents/${DOC_RECEIPT}`)
    expect(
      within(receipt).getByRole('link', { name: 'GRS-2026-000001 muhasebe fişini aç' }),
    ).toHaveAttribute('href', `/accounting/journal-entries/${JE_RECEIPT}`)
  })

  it('hides document and journal links without their permissions', async () => {
    setupInventoryStock({ permissions: ['inventory.stock.view'] })
    renderInventoryStock('/inventory/movements')
    const table = await screen.findByRole('table', { name: 'Stok hareketleri' })
    expect(within(table).getAllByText('GRS-2026-000001').length).toBeGreaterThan(0)
    expect(within(table).queryByRole('link', { name: /belgesini aç/ })).not.toBeInTheDocument()
    expect(
      within(table).queryByRole('link', { name: /muhasebe fişini aç/ }),
    ).not.toBeInTheDocument()
  })

  it('filters by type and date range through the URL', async () => {
    const db = setupInventoryStock()
    const user = userEvent.setup()
    const { router } = renderInventoryStock('/inventory/movements?filter[date_from]=2026-10-01')
    const table = await screen.findByRole('table', { name: 'Stok hareketleri' })
    expect(listCalls(db).at(-1)?.url.searchParams.get('filter[date_from]')).toBe('2026-10-01')
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3))

    await user.selectOptions(screen.getByLabelText('Hareket türü'), 'issue')
    await waitFor(() =>
      expect(listCalls(db).at(-1)?.url.searchParams.get('filter[movement_type]')).toBe('issue'),
    )
    expect(new URLSearchParams(router.state.location.search).get('filter[movement_type]')).toBe(
      'issue',
    )
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2),
    )
  })

  it('pages through a long ledger by cursor and virtualizes the rows', async () => {
    const db = setupInventoryStock({ db: { movements: longLedger() } })
    const user = userEvent.setup()
    renderInventoryStock('/inventory/movements')
    expect(await screen.findByText('100 hareket yüklendi')).toBeInTheDocument()
    expect(listCalls(db)[0]?.url.searchParams.has('cursor')).toBe(false)
    expect(listCalls(db)[0]?.url.searchParams.get('sort')).toBe('-seq')

    await user.click(screen.getByRole('button', { name: 'Daha fazla yükle' }))
    expect(await screen.findByText('200 hareket yüklendi')).toBeInTheDocument()
    expect(listCalls(db).at(-1)?.url.searchParams.get('cursor')).toBe('151')
    // Only a window of the 200 loaded rows is in the DOM.
    const rendered = document.querySelectorAll('[data-movement-id]').length
    expect(rendered).toBeLessThan(200)

    await user.click(screen.getByRole('button', { name: 'Daha fazla yükle' }))
    expect(await screen.findByText('250 hareket yüklendi')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Daha fazla yükle' })).not.toBeInTheDocument()
  })

  it('exports with the active filters', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const db = setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock('/inventory/movements?filter[direction]=out')
    await screen.findByRole('table', { name: 'Stok hareketleri' })
    await user.click(screen.getByRole('button', { name: 'CSV' }))
    await waitFor(() =>
      expect(db.calls.some((c) => c.path === '/stock-movements/export')).toBe(true),
    )
    const call = db.calls.find((c) => c.path === '/stock-movements/export')
    expect(call?.url.searchParams.get('filter[direction]')).toBe('out')
    expect(call?.url.searchParams.get('format')).toBe('csv')
  })
})
