import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ORDER_APPROVED, ORDER_DRAFT, ORDER_SENT } from '../../shared/test/handlers'
import { renderPurch, setupPurch, without } from '../../shared/test/testing'
import './OrderListPage'
import './OrderPage'

vi.setConfig({ testTimeout: 30_000 })

type User = ReturnType<typeof userEvent.setup>

async function typeInto(user: User, el: HTMLElement, text: string) {
  await user.click(el)
  await user.keyboard('{Control>}a{/Control}')
  await user.keyboard(text)
}

async function openWizard(user: User, button: string, title: string) {
  await screen.findByRole('heading', { name: 'Sipariş POR2026000000002' })
  await user.click(screen.getByRole('button', { name: button }))
  return screen.findByRole('dialog', { name: title })
}

describe('purchase order list', () => {
  beforeEach(() => window.localStorage.clear())

  it('filters by status through the API and keeps saved views per user and company', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch('/purchasing/orders?filter[status]=draft')
    const grid = await screen.findByRole('grid', { name: 'Satınalma siparişleri' })
    expect(await within(grid).findByText('Acme Tedarik A.Ş.')).toBeInTheDocument()
    expect(within(grid).queryByText('POR2026000000001')).not.toBeInTheDocument()
    const call = db.calls.filter((c) => c.path === '/purchase-orders').at(-1)
    expect(call?.url.searchParams.get('filter[status]')).toBe('draft')
    await user.click(screen.getByRole('button', { name: 'Kayıtlı görünümler' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Geçerli filtreleri kaydet…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Görünümü kaydet' })
    await user.type(within(dialog).getByLabelText(/Görünüm adı/), 'Taslaklar')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    const keys = Object.keys(window.localStorage).filter((k) => k.endsWith('.purchasing-orders'))
    expect(keys).toHaveLength(1)
    expect(keys[0]).toContain('0192a000-0000-7000-8000-00000000000a')
    expect(JSON.parse(window.localStorage.getItem(keys[0] ?? '') ?? '[]')).toEqual([
      { name: 'Taslaklar', params: { status: 'draft' } },
    ])
  })

  it('hides the new order button without create permission', async () => {
    setupPurch({ permissions: ['purchasing.orders.view'] })
    renderPurch('/purchasing/orders')
    await screen.findByRole('grid', { name: 'Satınalma siparişleri' })
    expect(screen.queryByRole('link', { name: 'Yeni sipariş' })).not.toBeInTheDocument()
  })
})

describe('permission-aware order actions', () => {
  it('shows no lifecycle buttons to a viewer', async () => {
    setupPurch({ permissions: ['purchasing.orders.view'] })
    renderPurch(`/purchasing/orders/${ORDER_APPROVED}`)
    await screen.findByRole('heading', { name: 'Sipariş POR2026000000001' })
    for (const name of [
      'Tedarikçiye gönderildi',
      'Revize et',
      'Siparişi iptal et',
      'Siparişi kapat',
      'Mal kabul oluştur',
      'Fatura oluştur',
    ])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  })

  it('offers each action only with its own permission', async () => {
    setupPurch({
      permissions: [
        'purchasing.orders.view',
        'purchasing.orders.update',
        'purchasing.receipts.create',
      ],
    })
    renderPurch(`/purchasing/orders/${ORDER_APPROVED}`)
    await screen.findByRole('heading', { name: 'Sipariş POR2026000000001' })
    // send and cancel are updates; revise and close need approve; conversions need the target's create.
    expect(screen.getByRole('button', { name: 'Tedarikçiye gönderildi' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Siparişi iptal et' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mal kabul oluştur' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revize et' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Siparişi kapat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fatura oluştur' })).not.toBeInTheDocument()
  })

  it('keeps a draft read-only without update permission', async () => {
    setupPurch({ permissions: ['purchasing.orders.view'] })
    renderPurch(`/purchasing/orders/${ORDER_DRAFT}`)
    await screen.findByRole('table', { name: 'Satırlar' })
    expect(screen.getByText('Bu belgeyi düzenleme yetkiniz yok.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Onaya gönder' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Taslağı kaydet' })).not.toBeInTheDocument()
  })
})

describe('order editor and submit', () => {
  it('saves typed decimal strings before submitting the saved version', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/orders/${ORDER_DRAFT}`)
    const table = await screen.findByRole('table', { name: 'Satırlar' })
    await typeInto(user, within(table).getByLabelText('Miktar, 1. satır'), '3')
    await typeInto(user, within(table).getByLabelText('Birim fiyat, 1. satır'), '0,1')
    await user.click(screen.getByRole('button', { name: 'Onaya gönder' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sipariş onaya gönderilsin mi?' })
    const patch = db.calls.find((c) => c.method === 'PATCH')
    const line = (patch?.body as { lines: Record<string, unknown>[] }).lines[0]
    // The inputs keep the API scale as decimal strings.
    expect(line).toMatchObject({
      id: `${ORDER_DRAFT}-l1`,
      quantity: '3.000000',
      unit_price: '0.100000',
    })
    // 3 × 0.1 = 0.30 net + 20% VAT 0.06 (decimal, no float drift): saved total 0.36.
    expect(within(dialog).getByText(/0,36/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Onaya gönder' }))
    expect(await screen.findByRole('heading', { name: /^Sipariş POR2026/ })).toBeInTheDocument()
    expect(db.calls.find((c) => c.path === `/purchase-orders/${ORDER_DRAFT}/submit`)?.body).toEqual(
      { version: 2 },
    )
  })

  it('reuses the idempotency key when a submit is retried after a lost response', async () => {
    const db = setupPurch({ db: { dropNext: ['/purchase-orders/submit'] } })
    const user = userEvent.setup()
    renderPurch(`/purchasing/orders/${ORDER_DRAFT}`)
    await screen.findByRole('table', { name: 'Satırlar' })
    await user.click(screen.getByRole('button', { name: 'Onaya gönder' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sipariş onaya gönderilsin mi?' })
    await user.click(within(dialog).getByRole('button', { name: 'Onaya gönder' }))
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Onaya gönder' })).toBeEnabled(),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Onaya gönder' }))
    expect(await screen.findByRole('heading', { name: /^Sipariş POR2026/ })).toBeInTheDocument()
    const keys = db.calls
      .filter((c) => c.path === `/purchase-orders/${ORDER_DRAFT}/submit`)
      .map((c) => c.headers.get('Idempotency-Key'))
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    // Submitted once: the replay did not bump the version again.
    expect(db.orders.find((o) => o.id === ORDER_DRAFT)?.version).toBe(2)
  })

  it('sends large orders for approval and shows the approval tab', async () => {
    setupPurch({ db: { orderApprovalOver: '100' } })
    const user = userEvent.setup()
    renderPurch(`/purchasing/orders/${ORDER_DRAFT}`)
    await screen.findByRole('table', { name: 'Satırlar' })
    await user.click(screen.getByRole('button', { name: 'Onaya gönder' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sipariş onaya gönderilsin mi?' })
    await user.click(within(dialog).getByRole('button', { name: 'Onaya gönder' }))
    expect(await screen.findByText(/Belge onay bekliyor/)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Onay süreci' }))
    expect(await screen.findByText('Satınalma müdürü')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mal kabul oluştur' })).not.toBeInTheDocument()
  })

  it('revises an approved order with the full payload and version', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/orders/${ORDER_APPROVED}`)
    await screen.findByRole('heading', { name: 'Sipariş POR2026000000001' })
    await user.click(screen.getByRole('button', { name: 'Revize et' }))
    const table = await screen.findByRole('table', { name: 'Satırlar' })
    await typeInto(user, within(table).getByLabelText('Miktar, 1. satır'), '6')
    await user.click(screen.getByRole('button', { name: 'Revizyonu kaydet' }))
    expect(
      await screen.findByRole('heading', { name: 'Sipariş POR2026000000001' }),
    ).toBeInTheDocument()
    const call = db.calls.find((c) => c.path === `/purchase-orders/${ORDER_APPROVED}/revise`)
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(call?.body).toMatchObject({
      version: 1,
      lines: [{ id: `${ORDER_APPROVED}-l1`, quantity: '6.000000', unit_price: '20' }],
    })
    expect(db.orders.find((o) => o.id === ORDER_APPROVED)?.revision).toBe(1)
  })

  it('shows withholding and the payable amount from the server preview', async () => {
    setupPurch()
    const user = userEvent.setup()
    renderPurch('/purchasing/orders/new')
    const supplier = await screen.findByRole('combobox', { name: /Tedarikçi/ })
    await user.type(supplier, 'Acme')
    await user.click(await screen.findByRole('option', { name: /Acme Tedarik/ }))
    const table = screen.getByRole('table', { name: 'Satırlar' })
    await user.type(within(table).getByLabelText('Stok kartı, 1. satır'), 'Cıvata')
    await user.click(await screen.findByRole('option', { name: /Cıvata M8/ }))
    await typeInto(user, within(table).getByLabelText('Miktar, 1. satır'), '10')
    await typeInto(user, within(table).getByLabelText('Birim fiyat, 1. satır'), '100')
    await user.type(within(table).getByLabelText('Tevkifat, 1. satır'), 'TEV')
    await user.click(await screen.findByRole('option', { name: /TEV5\/10/ }))
    // Net 1.000, KDV %10 = 100, half withheld = 50; payable 1.100 - 50.
    expect(await screen.findByTestId('withholding-total', {}, { timeout: 5000 })).toHaveTextContent(
      '50,00',
    )
    expect(screen.getByTestId('payable-total')).toHaveTextContent('1.050,00')
  })
})

describe('receipt and invoice wizard (partial quantities)', () => {
  it('bounds receipt quantities by the remaining quantity plus tolerance and sends partial lines', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/orders/${ORDER_SENT}`)
    const dialog = await openWizard(user, 'Mal kabul oluştur', 'POR2026000000002 için mal kabul')
    // 10 ordered + 10% tolerance - 4 received = 7; the default is what is left of the order (6).
    expect(within(dialog).getByTestId(`remaining-${ORDER_SENT}-l1`)).toHaveTextContent('7')
    const qty = within(dialog).getByLabelText('CVT-01 · Cıvata M8 miktarı')
    expect(qty).toHaveValue('6')
    expect(within(dialog).getByLabelText('NAK-01 · Nakliye hizmeti miktarı')).toBeDisabled()
    await typeInto(user, qty, '8')
    expect(within(dialog).getByText('En fazla 7 girilebilir.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'İleri' }))
    expect(within(dialog).getByText('Adım 1/2 · Miktarlar')).toBeInTheDocument()
    await typeInto(user, qty, '2,5')
    await user.click(within(dialog).getByRole('button', { name: 'İleri' }))
    await user.click(
      await within(dialog).findByRole('button', { name: 'Taslak mal kabul oluştur' }),
    )
    await waitFor(() => expect(db.receipts).toHaveLength(1))
    const call = db.calls.find((c) => c.path === `/purchase-orders/${ORDER_SENT}/receipts`)
    expect(call?.body).toMatchObject({
      warehouse_id: 'wh-main',
      lines: [{ order_line_id: `${ORDER_SENT}-l1`, quantity: '2.500000' }],
    })
  })

  it('bounds invoices by the received quantity unless the invoice receives the goods', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/orders/${ORDER_SENT}`)
    const dialog = await openWizard(user, 'Fatura oluştur', 'POR2026000000002 için alış faturası')
    const bolt = within(dialog).getByLabelText('CVT-01 · Cıvata M8 miktarı')
    // Received 4, invoiced 2 -> 2; the service line is bounded by its ordered quantity (3 - 1).
    expect(bolt).toHaveValue('2')
    expect(within(dialog).getByLabelText('NAK-01 · Nakliye hizmeti miktarı')).toHaveValue('2')
    await typeInto(user, bolt, '5')
    expect(within(dialog).getByText('En fazla 2 girilebilir.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: /fatura ile teslim al/ }))
    // Receive-on-invoice: up to the ordered quantity less invoiced (10 - 2), defaults refilled.
    expect(bolt).toHaveValue('8')
    await user.click(within(dialog).getByRole('button', { name: 'İleri' }))
    await user.type(within(dialog).getByLabelText(/Tedarikçi fatura no/), 'A-1001')
    await user.click(within(dialog).getByRole('button', { name: 'Taslak fatura oluştur' }))
    await waitFor(() => expect(db.invoices).toHaveLength(1))
    expect(db.invoices[0]).toMatchObject({
      receive_on_invoice: true,
      lines: [
        { order_line_id: `${ORDER_SENT}-l1`, quantity: '8' },
        { order_line_id: `${ORDER_SENT}-l2`, quantity: '2' },
      ],
    })
    expect(
      db.calls.find((c) => c.path === `/purchase-orders/${ORDER_SENT}/invoices`)?.body,
    ).toMatchObject({
      supplier_invoice_no: 'A-1001',
    })
  })

  it('maps a server bound error back to its line', async () => {
    // The tolerance is not readable: the wizard leaves the bound to the server.
    setupPurch({ db: { settingsReadable: false } })
    const user = userEvent.setup()
    renderPurch(`/purchasing/orders/${ORDER_SENT}`)
    const dialog = await openWizard(user, 'Mal kabul oluştur', 'POR2026000000002 için mal kabul')
    await typeInto(user, within(dialog).getByLabelText('CVT-01 · Cıvata M8 miktarı'), '9')
    await user.click(within(dialog).getByRole('button', { name: 'İleri' }))
    await user.click(
      await within(dialog).findByRole('button', { name: 'Taslak mal kabul oluştur' }),
    )
    expect(await within(dialog).findByText('En fazla 7 girilebilir.')).toBeInTheDocument()
    expect(within(dialog).getByText('Adım 1/2 · Miktarlar')).toBeInTheDocument()
  })

  it('reuses the key after a lost response when the wizard is closed and opened again', async () => {
    const db = setupPurch({ db: { dropNext: ['/purchase-orders/receipts'] } })
    const user = userEvent.setup()
    const { router } = renderPurch(`/purchasing/orders/${ORDER_SENT}`)
    const create = async () => {
      const dialog = await openWizard(user, 'Mal kabul oluştur', 'POR2026000000002 için mal kabul')
      await user.click(within(dialog).getByRole('button', { name: 'İleri' }))
      await user.click(
        await within(dialog).findByRole('button', { name: 'Taslak mal kabul oluştur' }),
      )
      return dialog
    }
    const dialog = await create()
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await create()
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/purchasing\/receipts\/g-new-/),
    )
    const keys = db.calls
      .filter((c) => c.path === `/purchase-orders/${ORDER_SENT}/receipts`)
      .map((c) => c.headers.get('Idempotency-Key'))
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
    // One receipt only: the retry was replayed.
    expect(db.receipts).toHaveLength(1)
  })

  it('hides the invoice wizard without invoices.create', async () => {
    setupPurch({ permissions: without('purchasing.invoices.create') })
    renderPurch(`/purchasing/orders/${ORDER_SENT}`)
    await screen.findByRole('heading', { name: 'Sipariş POR2026000000002' })
    expect(screen.getByRole('button', { name: 'Mal kabul oluştur' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fatura oluştur' })).not.toBeInTheDocument()
  })
})
