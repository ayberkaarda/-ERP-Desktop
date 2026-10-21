import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { INVOICE_DRAFT, INVOICE_ISSUED, PARTY_ACME } from '@/test/handlers/salesDocs'
import { ALL_SALES2_PERMISSIONS, renderSales, setupSales } from '../kit/testing'
import type { PreviewInput } from '../types'
import './InvoiceListPage'
import './InvoicePage'

vi.setConfig({ testTimeout: 20_000 })

describe('invoice list', () => {
  beforeEach(() => window.localStorage.clear())

  it('shows totals and open balances and filters open invoices', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales('/sales/invoices')
    const grid = await screen.findByRole('grid', { name: 'Satış faturaları' })
    const row = (await within(grid).findByText('SF2026000007')).closest('tr')
    if (!row) throw new Error('row')
    expect(within(row).getAllByText('1.200,00 TRY')).toHaveLength(2)
    expect(within(row).getByText('Kesildi')).toBeInTheDocument()
    expect(within(row).getByText('(vadesi geçti)')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Yalnız açık bakiyeli'))
    await waitFor(() =>
      expect(
        db.calls
          .filter((c) => c.path === '/sales-invoices')
          .at(-1)
          ?.url.searchParams.get('filter[open]'),
      ).toBe('1'),
    )
  })
})

describe('issued invoice', () => {
  it('shows balance due, the journal link and reverses with an idempotent request', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales(`/sales/invoices/${INVOICE_ISSUED}`)
    await screen.findByRole('heading', { name: 'Satış faturası SF2026000007' })
    expect(screen.getByTestId('balance-due')).toHaveTextContent('1.200,00 TRY')
    expect(screen.getByText('Açık')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Kaydı aç' })).toHaveAttribute(
      'href',
      '/accounting/journal-entries/je-inv-7',
    )
    expect(screen.getByRole('link', { name: /İade başlat/ })).toHaveAttribute(
      'href',
      `/sales/returns/new?invoice=${INVOICE_ISSUED}`,
    )

    await user.click(screen.getByRole('button', { name: 'Ters kayıt' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Neden/), 'Yanlış müşteri')
    await user.click(within(dialog).getByLabelText(/Stok hareketlerini de ters çevir/))
    await user.click(within(dialog).getByRole('button', { name: 'Ters kaydı oluştur' }))
    await waitFor(() =>
      expect(db.invoices.find((i) => i.id === INVOICE_ISSUED)?.status).toBe('reversed'),
    )
    const call = db.calls.find((c) => c.path === `/sales-invoices/${INVOICE_ISSUED}/reverse`)
    expect(call?.body).toMatchObject({ version: 4, reason: 'Yanlış müşteri', reverse_stock: true })
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(await screen.findByText('Ters kayıtlı')).toBeInTheDocument()
  })

  it('hides reverse and return without permissions', async () => {
    setupSales({ permissions: ['sales.invoices.view'] })
    renderSales(`/sales/invoices/${INVOICE_ISSUED}`)
    await screen.findByRole('heading', { name: 'Satış faturası SF2026000007' })
    expect(screen.queryByRole('button', { name: 'Ters kayıt' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /İade başlat/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Kaydı aç' })).not.toBeInTheDocument()
  })
})

describe('invoice editor', () => {
  it('prices edits through the server preview', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales(`/sales/invoices/${INVOICE_DRAFT}`)
    await screen.findByRole('heading', { name: 'Satış faturası (taslak)' })
    const table = screen.getByRole('table', { name: 'Fatura satırları' })
    const quantity = within(table).getByLabelText('Miktar, 1. satır')
    await user.clear(quantity)
    await user.type(quantity, '5')
    await user.tab()
    await waitFor(() => {
      const preview = db.calls.filter((c) => c.path === '/sales-documents/preview-totals').at(-1)
      expect((preview?.body as PreviewInput | undefined)?.lines[0]?.quantity).toBe('5.000000')
    })
    await waitFor(() => expect(screen.queryByText('Tahmini')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByLabelText('Hesaplanıyor')).not.toBeInTheDocument())
    expect(screen.getByTestId('doc-total')).toHaveTextContent('600,00 TRY')
    expect(within(table).getByTestId('line-net-0')).toHaveTextContent('500,00')
  })

  it('locks the unit price without price_override and hides issuing without the issue permission', async () => {
    setupSales({
      permissions: ['sales.invoices.view', 'sales.invoices.update'],
    })
    renderSales(`/sales/invoices/${INVOICE_DRAFT}`)
    const table = await screen.findByRole('table', { name: 'Fatura satırları' })
    expect(within(table).getByLabelText('Birim fiyat, 1. satır')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Faturayı kes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Taslağı kaydet' })).toBeInTheDocument()
  })

  it('issues with exposure shown and warn-mode notes, then shows the number', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales(`/sales/invoices/${INVOICE_DRAFT}`)
    await screen.findByRole('heading', { name: 'Satış faturası (taslak)' })
    await user.click(screen.getByRole('button', { name: 'Faturayı kes' }))
    const dialog = await screen.findByRole('dialog')
    const exposure = await within(dialog).findByTestId('exposure')
    expect(exposure).toHaveTextContent('2.000,00 TRY')
    // 500 available − 1 200 this invoice.
    expect(exposure).toHaveTextContent('-700,00 TRY')
    await user.click(within(dialog).getByRole('button', { name: 'Faturayı kes' }))
    expect(await screen.findByTestId('assigned-number')).toHaveTextContent('SF2026000001')
    expect(await screen.findByText('Risk limiti aşıldı (uyarı).')).toBeInTheDocument()
    const issue = db.calls.find((c) => c.path === `/sales-invoices/${INVOICE_DRAFT}/issue`)
    expect(issue?.body).toEqual({ version: 3 })
  })

  it('does not subtract a TRY invoice from a EUR risk limit', async () => {
    setupSales({
      db: {
        exposure: {
          [PARTY_ACME]: {
            limit: '100.0000',
            currency: 'EUR',
            open_invoices: '20.0000',
            open_orders: '0.0000',
            total: '20.0000',
            available: '80.0000',
          },
        },
      },
    })
    const user = userEvent.setup()
    renderSales(`/sales/invoices/${INVOICE_DRAFT}`)
    await screen.findByRole('heading', { name: 'Satış faturası (taslak)' })
    await user.click(screen.getByRole('button', { name: 'Faturayı kes' }))
    const exposure = await within(await screen.findByRole('dialog')).findByTestId('exposure')
    expect(exposure).toHaveTextContent('100,00 EUR')
    // The invoice is shown in its own currency; no EUR availability is derived from TRY.
    expect(exposure).toHaveTextContent('1.200,00 TRY')
    expect(exposure).not.toHaveTextContent('Kesildikten sonra kalan')
  })

  it('stops at the credit limit in block mode without the override permission', async () => {
    setupSales({ db: { creditMode: 'block' } })
    const user = userEvent.setup()
    renderSales(`/sales/invoices/${INVOICE_DRAFT}`)
    await screen.findByRole('heading', { name: 'Satış faturası (taslak)' })
    await user.click(screen.getByRole('button', { name: 'Faturayı kes' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Faturayı kes' }))
    expect(await within(dialog).findByText('Müşterinin risk limiti aşılıyor.')).toBeInTheDocument()
    expect(within(dialog).getByText(/Limiti aşma yetkiniz yok/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Faturayı kes' })).toBeDisabled()
  })

  it('lets a credit_override holder issue over the limit with a reason and a new key', async () => {
    const permissions = [...ALL_SALES2_PERMISSIONS, 'sales.credit_override']
    const db = setupSales({ permissions, db: { creditMode: 'block' } })
    const user = userEvent.setup()
    renderSales(`/sales/invoices/${INVOICE_DRAFT}`)
    await screen.findByRole('heading', { name: 'Satış faturası (taslak)' })
    await user.click(screen.getByRole('button', { name: 'Faturayı kes' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Faturayı kes' }))
    const override = await within(dialog).findByRole('button', { name: 'Limiti aşarak kes' })
    expect(override).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Limit aşımı gerekçesi'), 'Yönetim onayı')
    await user.click(override)
    expect(await screen.findByTestId('assigned-number')).toHaveTextContent('SF2026000001')
    const issues = db.calls.filter((c) => c.path === `/sales-invoices/${INVOICE_DRAFT}/issue`)
    expect(issues.map((c) => c.body)).toEqual([
      { version: 3 },
      { version: 3, credit_override_reason: 'Yönetim onayı' },
    ])
    expect(issues[0]?.headers.get('Idempotency-Key')).not.toBe(
      issues[1]?.headers.get('Idempotency-Key'),
    )
  })
})

describe('print view', () => {
  it('lays out the print model and prints through the browser', async () => {
    setupSales()
    const user = userEvent.setup()
    const print = vi.fn()
    Object.assign(window, { print })
    renderSales(`/sales/invoices/${INVOICE_ISSUED}/print`)
    const sheet = await screen.findByTestId('print-sheet')
    expect(within(sheet).getByRole('heading', { name: 'Satış Faturası' })).toBeInTheDocument()
    expect(sheet).toHaveTextContent('SF2026000007')
    expect(sheet).toHaveTextContent('Kadıköy V.D. · 1234567890')
    expect(sheet).toHaveTextContent('Yalnız bin iki yüz Türk lirası')
    expect(sheet).toHaveTextContent('1.200,00 TRY')
    await user.click(screen.getByRole('button', { name: 'Yazdır' }))
    expect(print).toHaveBeenCalledOnce()
  })
})
