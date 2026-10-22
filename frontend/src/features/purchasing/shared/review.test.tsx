import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ORDER_APPROVED, ORDER_DRAFT, REQ_APPROVED, RFQ_DRAFT } from './test/handlers'
import { renderPurch, setupPurch } from './test/testing'
import '../orders/pages/OrderPage'
import '../rfqs/pages/RfqPage'

// Page-level regression tests of the review findings (fe-purch1).

vi.setConfig({ testTimeout: 30_000 })

describe('review fixes on the pages', () => {
  it('never resends RFQ lines taken from a request and shows them read-only', async () => {
    const db = setupPurch()
    const rfq = db.rfqs.find((q) => q.id === RFQ_DRAFT)
    const first = rfq?.lines?.[0]
    if (!rfq || !first) throw new Error('fixture')
    rfq.request_id = REQ_APPROVED
    first.request_line_id = `${REQ_APPROVED}-l1`
    const user = userEvent.setup()
    renderPurch(`/purchasing/rfqs/${RFQ_DRAFT}`)
    const table = await screen.findByRole('table', { name: 'Satırlar' })
    expect(screen.getByText(/Talepten gelen satırlar burada değiştirilemez/)).toBeInTheDocument()
    expect(within(table).getByLabelText('Miktar, 1. satır')).toBeDisabled()
    await user.type(screen.getByRole('combobox', { name: /Davet edilen tedarikçiler/ }), 'Beta')
    await user.click(await screen.findByRole('option', { name: /Beta Endüstri/ }))
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() => expect(db.calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(db.calls.find((c) => c.method === 'PATCH')?.body).not.toHaveProperty('lines')
  })

  it('keeps a stored rate of 1 and the tax-inclusive flag when an order is edited', async () => {
    const db = setupPurch()
    const order = db.orders.find((o) => o.id === ORDER_DRAFT)
    const first = order?.lines?.[0]
    if (!order || !first) throw new Error('fixture')
    order.currency_code = 'EUR'
    order.fx_rate = '1.000000'
    first.tax_inclusive = true
    const user = userEvent.setup()
    renderPurch(`/purchasing/orders/${ORDER_DRAFT}`)
    const table = await screen.findByRole('table', { name: 'Satırlar' })
    expect(within(table).getByText('KDV dahil fiyat')).toBeInTheDocument()
    await user.click(within(table).getByLabelText('Miktar, 1. satır'))
    await user.keyboard('{Control>}a{/Control}12')
    await waitFor(
      () =>
        expect(db.calls.some((c) => c.path === '/purchase-documents/preview-totals')).toBe(true),
      { timeout: 5000 },
    )
    const preview = db.calls.find((c) => c.path === '/purchase-documents/preview-totals')
    expect(preview?.body).toMatchObject({ fx_rate: '1', lines: [{ tax_inclusive: true }] })
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() => expect(db.calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(db.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      currency_code: 'EUR',
      fx_rate: '1',
      lines: [{ tax_inclusive: true }],
    })
  })

  it('offers a receipt within the over-receipt tolerance after the full quantity arrived', async () => {
    const db = setupPurch()
    const order = db.orders.find((o) => o.id === ORDER_APPROVED)
    const first = order?.lines?.[0]
    if (!order || !first) throw new Error('fixture')
    order.status = 'received'
    first.received_quantity = '5.000000'
    const user = userEvent.setup()
    renderPurch(`/purchasing/orders/${ORDER_APPROVED}`)
    await screen.findByRole('heading', { name: 'Sipariş POR2026000000001' })
    // 5 ordered + 10% tolerance - 5 received = 0.5 still receivable.
    await user.click(await screen.findByRole('button', { name: 'Mal kabul oluştur' }))
    const dialog = await screen.findByRole('dialog', { name: 'POR2026000000001 için mal kabul' })
    expect(within(dialog).getByTestId(`remaining-${ORDER_APPROVED}-l1`)).toHaveTextContent('0,5')
  })
})
