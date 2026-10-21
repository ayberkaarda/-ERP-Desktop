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

  it('shows period figures, monthly sales, top items and the risk position', async () => {
    const db = setupSales({ permissions: ['sales.invoices.view'] })
    renderTab(PARTY_ACME)
    expect(await screen.findByTestId('summary-net-sales')).toHaveTextContent('15.400,00 TRY')
    expect(screen.getByRole('table', { name: 'En çok alınan ürünler' })).toHaveTextContent(
      'Cıvata M8',
    )
    expect(screen.getByTestId('report-chart')).toBeInTheDocument()
    expect(await screen.findByTestId('summary-exposure')).toHaveTextContent('500,00 TRY')
    const call = db.calls.find((c) => c.path === `/customers/${PARTY_ACME}/sales-summary`)
    expect(call?.url.searchParams.get('date_from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('needs one of the sales read permissions', async () => {
    const db = setupSales({ permissions: ['parties.view'] })
    renderTab(PARTY_ACME)
    expect(await screen.findByText('Satış özetini görme yetkiniz yok.')).toBeInTheDocument()
    expect(db.calls.some((c) => c.path.startsWith('/customers/'))).toBe(false)
  })
})
