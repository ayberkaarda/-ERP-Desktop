import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ORDER_1, SUPPLIER } from '@/test/handlers/purchDocs'
import { renderPurch, setupPurch } from '../../invoices/kit/testing'
import { groupsOf, REPORTS } from '../definitions'
import { linkTarget, metaTotals, ratioToPercent } from '../lib/values'
import './PurchaseReportPage'

vi.setConfig({ testTimeout: 20_000 })

const ageingTotals = {
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
}

describe('report definitions against the purchrep request rules', () => {
  // PurchaseReportRequest::REPORTS: group_by values per report, the default first.
  const backend: Record<string, string[]> = {
    'purchases-by-period': [],
    'by-supplier': [],
    'by-item': [],
    'top-suppliers': [],
    'open-orders': ['line', 'order', 'supplier', 'item'],
    'receipt-vs-invoice': ['line', 'receipt', 'supplier', 'item'],
    'supplier-ageing': ['supplier', 'supplier_currency', 'invoice'],
    'price-variance': ['line', 'supplier', 'item'],
    'supplier-performance': [],
    'return-rate': ['supplier', 'item', 'category'],
    'rfq-savings': ['rfq', 'line', 'supplier'],
  }

  it('offers exactly the backend group_by values and only day|week|month periods', () => {
    for (const def of REPORTS) {
      expect(groupsOf(def), def.slug).toEqual(backend[def.slug])
      const period = def.params.find((p) => p.key === 'period')
      if (period) expect(period.options?.map((o) => o.value)).toEqual(['day', 'week', 'month'])
    }
  })

  it('asks each report only for the filters it applies', () => {
    const keys = (slug: string) => REPORTS.find((r) => r.slug === slug)?.params.map((p) => p.key)
    expect(keys('supplier-ageing')).toEqual(['group_by', 'as_of', 'party_id', 'currency_code'])
    expect(keys('supplier-performance')).toEqual(['date_from', 'date_to', 'party_id'])
    expect(keys('rfq-savings')).toEqual(
      expect.arrayContaining(['item_id', 'category_id', 'warehouse_id', 'currency_code']),
    )
    expect(keys('top-suppliers')).toContain('party_id')
    expect(keys('price-variance')).toContain('category_id')
  })

  it('turns 0..1 rates into exact percentages and resolves price-variance links', () => {
    expect(ratioToPercent('0.7525')).toBe('75.25')
    expect(ratioToPercent('0.1')).toBe('10')
    expect(ratioToPercent('')).toBe('')
    expect(linkTarget('source', { source: 'debit_note' })).toBe('invoice')
    expect(linkTarget('source', { source: 'return' })).toBe('return')
    expect(linkTarget('order', {})).toBe('order')
    expect(metaTotals({ totals: { not_due: '5.0000', invoice_count: 2 } })).toEqual({
      not_due: '5.0000',
      invoice_count: '2',
    })
  })
})

describe('report pages against real row shapes', () => {
  beforeEach(() => window.localStorage.clear())

  it('shows performance rates as percentages and charts them', async () => {
    setupPurch({
      db: {
        reports: {
          'supplier-performance': {
            rows: [
              {
                party_id: SUPPLIER,
                party_code: 'S001',
                party_name: 'Tedarik Ltd.',
                orders: 3,
                receipt_lines: 4,
                on_time_lines: 3,
                on_time_rate: '0.7500',
                ordered_quantity: '10.000000',
                received_on_orders: '9.000000',
                fill_rate: '0.9000',
                avg_lead_days: '4.5',
                price_variance_total: '20.00',
                received_quantity: '9.000000',
                returned_quantity: '1.000000',
                return_rate: '0.1111',
                overdue_payable: '0.00',
              },
            ],
            meta: { totals: { supplier_count: 1 } },
          },
        },
      },
    })
    renderPurch('/purchasing/reports/supplier-performance?run=1')
    const table = await screen.findByRole('table', { name: 'Tedarikçi performansı' })
    expect(within(table).getByText('%75')).toBeInTheDocument()
    expect(within(table).getByText('%90')).toBeInTheDocument()
    expect(within(table).getByText('%11,11')).toBeInTheDocument()
    expect(within(screen.getByTestId('report-chart')).getByText('%75')).toBeInTheDocument()
  })

  it('charts the ageing buckets of the invoice view from the unfiltered meta totals', async () => {
    setupPurch({
      db: {
        reports: {
          'supplier-ageing': {
            rows: [
              {
                invoice_id: 'invoice-booked',
                number: 'PIN2026000000007',
                document_date: '2026-09-01',
                due_date: '2026-10-01',
                days_overdue: 21,
                bucket: 'days_0_30',
                party_name: 'Tedarik Ltd.',
                currency_code: 'TRY',
                payable: '220.0000',
                settled_amount: '0.0000',
                balance: '220.0000',
                balance_local: '220.0000',
              },
            ],
            meta: ageingTotals,
          },
        },
      },
    })
    renderPurch('/purchasing/reports/supplier-ageing?group_by=invoice&as_of=2026-10-22')
    const table = await screen.findByRole('table', { name: 'Tedarikçi yaşlandırma' })
    expect(within(table).getByText('0-30 gün')).toBeInTheDocument()
    expect(within(screen.getByTestId('report-chart')).getByText('90+ gün')).toBeInTheDocument()
  })

  it('renders document numbers as plain text without the target view permission', async () => {
    const rows = [
      {
        order_id: ORDER_1,
        order_number: 'POR2026000000001',
        document_date: '2026-10-01',
        party_name: 'Tedarik Ltd.',
        currency_code: 'TRY',
        line_count: 2,
        open_value: '600.0000',
        open_value_local: '600.0000',
      },
    ]
    setupPurch({
      permissions: ['purchasing.reports.view'],
      db: { reports: { 'open-orders': { rows } } },
    })
    const view = renderPurch('/purchasing/reports/open-orders?group_by=order')
    const table = await screen.findByRole('table', { name: 'Açık siparişler' })
    expect(within(table).getByText('POR2026000000001')).toBeInTheDocument()
    expect(within(table).queryByRole('link')).not.toBeInTheDocument()
    view.unmount()

    setupPurch({
      permissions: ['purchasing.reports.view', 'purchasing.orders.view'],
      db: { reports: { 'open-orders': { rows } } },
    })
    renderPurch('/purchasing/reports/open-orders?group_by=order')
    const linked = await screen.findByRole('table', { name: 'Açık siparişler' })
    expect(within(linked).getByRole('link', { name: 'POR2026000000001' })).toHaveAttribute(
      'href',
      `/purchasing/orders/${ORDER_1}`,
    )
  })

  it('runs RFQ savings with its default rfq grouping (the mock refuses unknown groups)', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch('/purchasing/reports/rfq-savings')
    await screen.findByRole('heading', { name: 'Teklif tasarrufu' })
    await user.click(screen.getByRole('button', { name: 'Çalıştır' }))
    expect(await screen.findByText('Bu parametrelerle kayıt yok.')).toBeInTheDocument()
    const call = db.calls.filter((c) => c.path === '/purchase-reports/rfq-savings').at(-1)
    expect(call?.url.searchParams.get('group_by')).toBe('rfq')
  })

  it('shows the server refusal of an unknown grouping from a stale link', async () => {
    setupPurch()
    renderPurch('/purchasing/reports/price-variance?group_by=invoice')
    expect(await screen.findByText('Geçersiz gruplama.')).toBeInTheDocument()
  })
})
