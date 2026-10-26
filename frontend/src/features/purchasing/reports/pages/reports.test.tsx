import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Providers } from '@/app/providers'
import { createQueryClient } from '@/lib/queryClient'
import { SUPPLIER } from '@/test/handlers/purchDocs'
import { renderPurch, setupPurch } from '../../invoices/kit/testing'
import { SupplierPurchaseSummary } from '../components/SupplierPurchaseSummary'
import { REPORTS } from '../definitions'
import { purchaseReportsCommands } from '../commands'
import './PurchaseReportPage'
import './PurchaseReportsHubPage'

vi.setConfig({ testTimeout: 20_000 })

const ageing = {
  rows: [
    {
      party_id: SUPPLIER,
      party_code: 'S001',
      party_name: 'Tedarik Ltd.',
      invoice_count: 2,
      balance_local: '1500.0000',
      not_due: '500.0000',
      days_0_30: '400.0000',
      days_31_60: '300.0000',
      days_61_90: '200.0000',
      days_over_90: '100.0000',
      overdue: '1000.0000',
      oldest_due_date: '2026-06-01',
    },
  ],
  meta: {
    totals: {
      invoice_count: 2,
      balance_local: '1500.0000',
      not_due: '500.0000',
      days_0_30: '400.0000',
      days_31_60: '300.0000',
      days_61_90: '200.0000',
      days_over_90: '100.0000',
      overdue: '1000.0000',
    },
  },
}

describe('purchasing reports', () => {
  beforeEach(() => window.localStorage.clear())

  it('lists the eleven reports for report viewers and guards each report', async () => {
    setupPurch({ permissions: ['purchasing.reports.view'] })
    const first = renderPurch('/purchasing/reports')
    await screen.findByRole('heading', { name: 'Satın alma raporları' })
    const links = screen
      .getAllByRole('link', { name: /./ })
      .filter((l) => l.getAttribute('href')?.startsWith('/purchasing/reports/'))
    expect(links).toHaveLength(11)
    expect(screen.getByRole('link', { name: /Faturalanmamış mal kabuller/ })).toHaveAttribute(
      'href',
      '/purchasing/reports/receipt-vs-invoice',
    )
    first.unmount()

    setupPurch({ permissions: ['purchasing.invoices.view'] })
    renderPurch('/purchasing/reports/supplier-ageing')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()
  })

  it('runs the ageing report with buckets chart, totals and an export with the same parameters', async () => {
    const db = setupPurch({ db: { reports: { 'supplier-ageing': ageing } } })
    const user = userEvent.setup()
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    const { router } = renderPurch('/purchasing/reports/supplier-ageing')
    await screen.findByRole('heading', { name: 'Tedarikçi yaşlandırma' })
    await user.click(screen.getByRole('button', { name: 'Çalıştır' }))
    const table = await screen.findByRole('table', { name: 'Tedarikçi yaşlandırma' })
    expect(within(table).getByText('Tedarik Ltd.')).toBeInTheDocument()
    expect(within(table).getByTestId('report-totals')).toHaveTextContent('1.500,00')
    const chart = screen.getByTestId('report-chart')
    expect(within(chart).getByText('90+ gün')).toBeInTheDocument()
    expect(router.state.location.search).toContain('group_by=supplier')
    const call = db.calls.filter((c) => c.path === '/purchase-reports/supplier-ageing').at(-1)
    expect(call?.url.searchParams.get('as_of')).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    await user.click(screen.getByRole('button', { name: 'CSV' }))
    await waitFor(() =>
      expect(db.calls.some((c) => c.path === '/purchase-reports/supplier-ageing/export')).toBe(
        true,
      ),
    )
    const exp = db.calls.find((c) => c.path === '/purchase-reports/supplier-ageing/export')
    expect(exp?.url.searchParams.get('format')).toBe('csv')
    expect(exp?.url.searchParams.get('group_by')).toBe('supplier')
  })

  it('switches columns with group_by and links documents', async () => {
    setupPurch({
      db: {
        reports: {
          'receipt-vs-invoice': {
            rows: [
              {
                receipt_id: 'receipt-posted',
                receipt_number: 'GRN2026000000001',
                document_date: '2026-10-06',
                days_open: 16,
                party_name: 'Tedarik Ltd.',
                line_count: 1,
                uninvoiced_value: '200.0000',
              },
            ],
          },
        },
      },
    })
    renderPurch('/purchasing/reports/receipt-vs-invoice?group_by=receipt&as_of=2026-10-22')
    const table = await screen.findByRole('table', { name: 'Faturalanmamış mal kabuller' })
    expect(within(table).getByRole('link', { name: 'GRN2026000000001' })).toHaveAttribute(
      'href',
      '/purchasing/receipts/receipt-posted',
    )
    expect(within(table).queryByRole('columnheader', { name: 'Stok kodu' })).not.toBeInTheDocument()
  })

  it('registers a palette entry per report behind the report permission', () => {
    const commands = purchaseReportsCommands()
    expect(commands).toHaveLength(REPORTS.length + 1)
    expect(commands.every((c) => c.permission === 'purchasing.reports.view')).toBe(true)
  })
})

describe('supplier purchase summary', () => {
  const renderSummary = () => {
    const router = createMemoryRouter([
      { path: '/', element: <SupplierPurchaseSummary partyId={SUPPLIER} /> },
    ])
    return render(
      <Providers queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </Providers>,
    )
  }

  it('shows exposure, balances, performance and the latest documents', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderSummary()
    expect(await screen.findByTestId('supplier-exposure-total')).toHaveTextContent('820,00 TRY')
    expect(screen.getByTestId('supplier-overdue')).toHaveClass('text-danger')
    expect(screen.getByTestId('supplier-balance')).toHaveTextContent('220,00 TRY')
    const perf = await screen.findByTestId('supplier-performance')
    // Fractions from the API shown as percentages.
    expect(within(perf).getByText('%75')).toBeInTheDocument()
    expect(within(perf).getByText('%90')).toBeInTheDocument()
    expect(within(perf).getByText('%2')).toBeInTheDocument()
    expect(within(screen.getByTestId('recent-invoices')).getByRole('link')).toHaveAttribute(
      'href',
      '/purchasing/invoices/invoice-booked',
    )
    const from = screen.getByLabelText('Başlangıç')
    await user.clear(from)
    await user.click(from)
    await user.paste('01.01.2026')
    await user.tab()
    await waitFor(() =>
      expect(
        db.calls
          .filter((c) => c.path === `/suppliers/${SUPPLIER}/performance`)
          .at(-1)
          ?.url.searchParams.get('from'),
      ).toBe('2026-01-01'),
    )
  })

  it('tells users without purchasing order or invoice rights that they have no access', async () => {
    const db = setupPurch({ permissions: ['purchasing.reports.view'] })
    renderSummary()
    expect(await screen.findByText('Tedarikçi özetini görme yetkiniz yok.')).toBeInTheDocument()
    expect(db.calls.some((c) => c.path.startsWith('/suppliers/'))).toBe(false)
  })
})
