import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { createQueryClient } from '@/lib/queryClient'
import { PARTY_ACME } from '@/test/handlers/salesDocs'
import { renderSales, setupSales } from '../../invoices/kit/testing'
import { CustomerSalesSummary } from '../components/CustomerSalesSummary'
import './SalesReportPage'
import './SalesReportsHubPage'

vi.setConfig({ testTimeout: 20_000 })

describe('sales reports', () => {
  beforeEach(() => window.localStorage.clear())

  it('lists the reports for report viewers only', async () => {
    setupSales({ permissions: ['sales.reports.view'] })
    const first = renderSales('/sales/reports')
    await screen.findByRole('heading', { name: 'Satış raporları' })
    expect(screen.getByRole('link', { name: /Döneme göre satışlar/ })).toHaveAttribute(
      'href',
      '/sales/reports/sales-by-period',
    )
    expect(
      screen
        .getAllByRole('link', { name: /./ })
        .filter((l) => l.getAttribute('href')?.startsWith('/sales/reports/')),
    ).toHaveLength(11)
    first.unmount()

    setupSales({ permissions: ['sales.invoices.view'] })
    renderSales('/sales/reports/margin')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()
  })

  it('runs a report with chart and totals and exports it with the same parameters', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    const { router } = renderSales('/sales/reports/sales-by-period')
    await screen.findByRole('heading', { name: 'Döneme göre satışlar' })
    expect(screen.getByText('Parametreleri seçip raporu çalıştırın.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Çalıştır' }))

    const table = await screen.findByRole('table', { name: 'Döneme göre satışlar' })
    expect(within(table).getByText('2026-09')).toBeInTheDocument()
    expect(within(table).getByTestId('report-totals')).toHaveTextContent('14.400,00')
    expect(screen.getByTestId('report-chart')).toBeInTheDocument()
    expect(router.state.location.search).toContain('period=month')
    const call = db.calls.filter((c) => c.path === '/sales-reports/sales-by-period').at(-1)
    expect(call?.url.searchParams.get('period')).toBe('month')
    expect(call?.url.searchParams.get('date_from')).toMatch(/^\d{4}-01-01$/)

    await user.click(screen.getByRole('button', { name: 'CSV' }))
    await waitFor(() =>
      expect(db.calls.some((c) => c.path === '/sales-reports/sales-by-period/export')).toBe(true),
    )
    const exp = db.calls.find((c) => c.path === '/sales-reports/sales-by-period/export')
    expect(exp?.url.searchParams.get('format')).toBe('csv')
    expect(exp?.url.searchParams.get('period')).toBe('month')
    expect(exp?.url.searchParams.has('page')).toBe(false)
  })

  it('pages every report and leaves group_by out of reports that refuse it', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales('/sales/reports/sales-by-period')
    await user.click(await screen.findByRole('button', { name: 'Çalıştır' }))
    await screen.findByRole('table', { name: 'Döneme göre satışlar' })
    const call = db.calls.filter((c) => c.path === '/sales-reports/sales-by-period').at(-1)
    expect(call?.url.searchParams.get('page')).toBe('1')
    expect(call?.url.searchParams.get('per_page')).toBe('100')
    expect(call?.url.searchParams.has('group_by')).toBe(false)
  })

  it('switches margin columns with group_by and names warehouses and categories', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales('/sales/reports/margin')
    await user.click(await screen.findByRole('button', { name: 'Çalıştır' }))
    let table = await screen.findByRole('table', { name: 'Kârlılık' })
    expect(within(table).getByText('Civata')).toBeInTheDocument()
    await waitFor(() => expect(within(table).getByText('HRD · Hırdavat')).toBeInTheDocument())
    expect(within(table).getByTestId('report-totals')).toHaveTextContent('300,00')
    expect(
      db.calls
        .filter((c) => c.path === '/sales-reports/margin')
        .at(-1)
        ?.url.searchParams.get('group_by'),
    ).toBe('item')

    await user.selectOptions(screen.getByLabelText('Gruplama'), 'warehouse')
    await user.click(screen.getByRole('button', { name: 'Çalıştır' }))
    await waitFor(() =>
      expect(
        db.calls
          .filter((c) => c.path === '/sales-reports/margin')
          .at(-1)
          ?.url.searchParams.get('group_by'),
      ).toBe('warehouse'),
    )
    table = await screen.findByRole('table', { name: 'Kârlılık' })
    await waitFor(() => expect(within(table).getByText('ANA · Ana depo')).toBeInTheDocument())
    expect(within(table).queryByText('Civata')).not.toBeInTheDocument()
  })

  it('lists categories by name and uncategorised sales separately', async () => {
    setupSales()
    const user = userEvent.setup()
    renderSales('/sales/reports/by-category')
    await user.click(await screen.findByRole('button', { name: 'Çalıştır' }))
    const table = await screen.findByRole('table', { name: 'Kategoriye göre satışlar' })
    await waitFor(() => expect(within(table).getByText('HRD · Hırdavat')).toBeInTheDocument())
    expect(within(table).getByText('Kategorisiz')).toBeInTheDocument()
    expect(within(table).getByTestId('report-totals')).toHaveTextContent('1.000,00')
  })

  it('links delivery-vs-invoice rows to their documents', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales('/sales/reports/delivery-vs-invoice')
    await user.click(await screen.findByRole('button', { name: 'Çalıştır' }))
    const table = await screen.findByRole('table', { name: 'İrsaliye - fatura karşılaştırması' })
    expect(within(table).getByRole('link', { name: 'DLV2026000000001' })).toHaveAttribute(
      'href',
      '/sales/deliveries/dlv-1',
    )
    expect(within(table).getByRole('link', { name: 'ORD2026000000001' })).toHaveAttribute(
      'href',
      '/sales/orders/ord-1',
    )
    expect(within(table).getByTestId('report-totals')).toHaveTextContent('150,00')
    const call = db.calls.filter((c) => c.path === '/sales-reports/delivery-vs-invoice').at(-1)
    expect(call?.url.searchParams.get('group_by')).toBe('line')
    expect(call?.url.searchParams.get('as_of')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(call?.url.searchParams.has('date_from')).toBe(false)
  })

  it('shows ageing per invoice with its bucket and a link', async () => {
    setupSales()
    const user = userEvent.setup()
    renderSales('/sales/reports/customer-ageing')
    await user.click(await screen.findByRole('button', { name: 'Çalıştır' }))
    await screen.findByRole('table', { name: 'Müşteri yaşlandırma' })
    await user.selectOptions(screen.getByLabelText('Gruplama'), 'invoice')
    await user.click(screen.getByRole('button', { name: 'Çalıştır' }))
    const table = await screen.findByRole('table', { name: 'Müşteri yaşlandırma' })
    await waitFor(() =>
      expect(within(table).getByRole('link', { name: 'INV2026000000007' })).toHaveAttribute(
        'href',
        '/sales/invoices/inv-recent-1',
      ),
    )
    expect(within(table).getByText('0-30 gün')).toBeInTheDocument()
  })

  it('draws ageing buckets from the totals', async () => {
    setupSales()
    const user = userEvent.setup()
    renderSales('/sales/reports/customer-ageing')
    await user.click(await screen.findByRole('button', { name: 'Çalıştır' }))
    const chart = await screen.findByTestId('report-chart')
    expect(within(chart).getByText('90+ gün')).toBeInTheDocument()
    expect(chart).toHaveTextContent('%80.0')
  })
})

describe('customer sales summary tab', () => {
  function renderTab(partyId: string) {
    const router = createMemoryRouter([
      { path: '/', element: <CustomerSalesSummary partyId={partyId} /> },
    ])
    return render(
      <Providers queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </Providers>,
    )
  }

  it('shows the summary figures, the risk position and the latest documents', async () => {
    const db = setupSales({ permissions: ['sales.invoices.view'] })
    renderTab(PARTY_ACME)
    expect(await screen.findByTestId('summary-invoiced')).toHaveTextContent('15.400,00 TRY')
    expect(screen.getByTestId('summary-balance')).toHaveTextContent('1.200,00 TRY')
    expect(screen.getByTestId('summary-open-orders')).toHaveTextContent('300,00 TRY (1)')
    expect(screen.getByTestId('summary-exposure')).toHaveTextContent('500,00 TRY')
    const invoices = screen.getByRole('table', { name: 'Son faturalar' })
    expect(within(invoices).getByRole('link', { name: 'INV2026000000007' })).toHaveAttribute(
      'href',
      '/sales/invoices/inv-recent-1',
    )
    const orders = screen.getByRole('table', { name: 'Son siparişler' })
    expect(within(orders).getByRole('link', { name: 'ORD2026000000004' })).toHaveAttribute(
      'href',
      '/sales/orders/ord-recent-1',
    )
    expect(orders).toHaveTextContent('Onaylandı')
    const call = db.calls.find((c) => c.path === `/customers/${PARTY_ACME}/sales-summary`)
    expect(call?.url.search).toBe('')
  })

  it('opens with the quotes permission alone, as the backend gate allows', async () => {
    setupSales({ permissions: ['sales.quotes.view'] })
    renderTab(PARTY_ACME)
    expect(await screen.findByTestId('summary-invoiced')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Tüm faturaları göster' })).not.toBeInTheDocument()
  })

  it('needs one of the sales read permissions', async () => {
    const db = setupSales({ permissions: ['parties.view', 'sales.reports.view'] })
    renderTab(PARTY_ACME)
    expect(await screen.findByText('Satış özetini görme yetkiniz yok.')).toBeInTheDocument()
    expect(db.calls.some((c) => c.path.startsWith('/customers/'))).toBe(false)
  })
})
