import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DOC_POSTED, ITEM_BOLT, WH_MAIN } from '@/test/handlers/inventoryDocs'
import { renderInvDocs, setupInvDocs } from '../../documents/testing'
import './InventoryReportPage'
import './ReportsHubPage'

vi.setConfig({ testTimeout: 20_000 })

describe('inventory reports', () => {
  beforeEach(() => window.localStorage.clear())

  it('runs stock status as of a date with totals and exports it', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { router } = renderInvDocs('/inventory/reports/stock-status')
    await screen.findByRole('heading', { name: 'Tarihe göre stok durumu' })
    expect(screen.getByText('Parametreleri seçip raporu çalıştırın.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Çalıştır' }))
    const table = await screen.findByRole('table', { name: 'Tarihe göre stok durumu' })
    expect(within(table).getByText('Cıvata M8')).toBeInTheDocument()
    expect(within(table).getByTestId('report-totals')).toHaveTextContent('1.450,00')
    const call = db.calls.filter((c) => c.path === '/inventory-reports/stock-status').at(-1)
    expect(call?.url.searchParams.get('as_of')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(call?.url.searchParams.get('include_zero')).toBe('0')
    expect(router.state.location.search).toContain('as_of=')

    await user.click(screen.getByRole('button', { name: 'Excel' }))
    await waitFor(() =>
      expect(db.calls.some((c) => c.path === '/inventory-reports/stock-status/export')).toBe(true),
    )
    const exp = db.calls.find((c) => c.path === '/inventory-reports/stock-status/export')
    expect(exp?.url.searchParams.get('format')).toBe('xlsx')
    click.mockRestore()
  })

  it('shows the kartex with devir and closing rows and document links', async () => {
    setupInvDocs()
    renderInvDocs(
      `/inventory/reports/stock-ledger?item_id=${ITEM_BOLT}&date_from=2026-10-01&date_to=2026-10-31`,
    )
    const table = await screen.findByRole('table', { name: 'Karteks (stok defteri)' })
    expect(within(table).getByTestId('ledger-opening')).toHaveTextContent('Devir')
    expect(within(table).getByTestId('ledger-opening')).toHaveTextContent('125,00')
    expect(within(table).getByTestId('ledger-closing')).toHaveTextContent('250,00')
    expect(within(table).getByRole('link', { name: 'CIK-2026-000001' })).toHaveAttribute(
      'href',
      `/inventory/documents/${DOC_POSTED}`,
    )
  })

  it('needs an item before the kartex can run', async () => {
    setupInvDocs()
    renderInvDocs('/inventory/reports/stock-ledger')
    await screen.findByRole('heading', { name: 'Karteks (stok defteri)' })
    expect(screen.getByRole('button', { name: 'Çalıştır' })).toBeDisabled()
  })

  it('saves and reapplies a parameter set', async () => {
    setupInvDocs()
    const user = userEvent.setup()
    const { router } = renderInvDocs(
      `/inventory/reports/valuation?as_of=2026-09-30&warehouse_id=${WH_MAIN}`,
    )
    await screen.findByRole('table', { name: 'Stok değerleme' })
    await user.click(screen.getByRole('button', { name: 'Kayıtlı parametreler' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Geçerli ayarları kaydet…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ayarları kaydet' })
    await user.type(within(dialog).getByLabelText(/^Ad/), 'Eylül ana depo')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    const stored = JSON.parse(
      window.localStorage.getItem('keystone.presets.inventory.reports.valuation') ?? '[]',
    ) as { name: string; params: Record<string, string> }[]
    expect(stored[0]).toEqual({
      name: 'Eylül ana depo',
      params: { as_of: '2026-09-30', warehouse_id: WH_MAIN },
    })
    await router.navigate('/inventory/reports/valuation')
    await user.click(screen.getByRole('button', { name: 'Kayıtlı parametreler' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Eylül ana depo' }))
    await waitFor(() => expect(router.state.location.search).toContain('as_of=2026-09-30'))
  })

  it('renders ageing buckets, ABC classes and reorder suggestions', async () => {
    setupInvDocs()
    const { unmount } = renderInvDocs('/inventory/reports/ageing?as_of=2026-10-21')
    const ageing = await screen.findByRole('table', { name: 'Stok yaşlandırma' })
    expect(within(ageing).getByTestId('report-totals')).toHaveTextContent('175,00')
    unmount()
    const abc = renderInvDocs(
      '/inventory/reports/abc-analysis?date_from=2026-01-01&date_to=2026-10-21',
    )
    const table = await screen.findByRole('table', { name: 'ABC analizi' })
    expect(within(table).getByText('A')).toBeInTheDocument()
    expect(within(table).getAllByText('%90,00')).toHaveLength(2)
    abc.unmount()
    renderInvDocs('/inventory/reports/reorder-suggestions?run=1')
    const reorder = await screen.findByRole('table', { name: 'Sipariş önerileri' })
    expect(within(reorder).getByText('112')).toBeInTheDocument()
  })

  it('lists only the reports the user may open', async () => {
    setupInvDocs({ permissions: ['inventory.stock.view'] })
    renderInvDocs('/inventory/reports')
    await screen.findByRole('heading', { name: 'Stok raporları' })
    expect(screen.getByRole('link', { name: /Sipariş önerileri/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Stok değerleme/ })).not.toBeInTheDocument()
  })

  it('forbids a report without its permission', async () => {
    setupInvDocs({ permissions: ['inventory.stock.view'] })
    renderInvDocs('/inventory/reports/valuation')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()
  })
})
