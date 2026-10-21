import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ORDER_CONFIRMED, ORDER_DRAFT } from '../../shared/test/handlers'
import { ALL_SALES_PERMISSIONS, renderSales, setupSales } from '../../shared/test/testing'
import './OrderListPage'
import './OrderPage'

vi.setConfig({ testTimeout: 30_000 })

const without = (...names: string[]) => ALL_SALES_PERMISSIONS.filter((p) => !names.includes(p))

async function openConfirm(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('table', { name: 'Satırlar' })
  await user.click(screen.getByRole('button', { name: 'Onayla' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Sipariş onaylansın mı?' })
  await user.click(within(dialog).getByRole('button', { name: 'Onayla' }))
}

describe('order list', () => {
  beforeEach(() => window.localStorage.clear())

  it('lists orders and keeps saved views per user and company', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales('/sales/orders?filter[status]=draft')
    const grid = await screen.findByRole('grid', { name: 'Satış siparişleri' })
    expect(await within(grid).findByText('SIP2026000001')).toBeInTheDocument()
    expect(within(grid).queryByText('SIP2026000002')).not.toBeInTheDocument()
    expect(
      db.calls
        .filter((c) => c.path === '/sales-orders')
        .at(-1)
        ?.url.searchParams.get('filter[status]'),
    ).toBe('draft')
    await user.click(screen.getByRole('button', { name: 'Kayıtlı görünümler' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Geçerli filtreleri kaydet…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Görünümü kaydet' })
    await user.type(within(dialog).getByLabelText(/Görünüm adı/), 'Taslaklar')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    const keys = Object.keys(window.localStorage).filter((k) =>
      k.startsWith('keystone.presets.sales.'),
    )
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/\.orders$/)
    expect(keys[0]).toContain('0192a000-0000-7000-8000-00000000000a')
    expect(JSON.parse(window.localStorage.getItem(keys[0] ?? '') ?? '[]')).toEqual([
      { name: 'Taslaklar', params: { status: 'draft' } },
    ])
  })
})

describe('order confirmation', () => {
  it('saves edits first and confirms exactly the order the dialog describes', async () => {
    const db = setupSales({ db: { creditMode: 'off' } })
    const user = userEvent.setup()
    renderSales(`/sales/orders/${ORDER_DRAFT}`)
    const table = await screen.findByRole('table', { name: 'Satırlar' })
    await user.click(within(table).getByLabelText('Miktar, 1. satır'))
    await user.keyboard('{Control>}a{/Control}20')
    await user.click(screen.getByRole('button', { name: 'Onayla' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sipariş onaylansın mı?' })
    // Saved before the dialog opened: 20 × 10 + 20% VAT.
    expect(db.calls.some((c) => c.method === 'PATCH')).toBe(true)
    expect(within(dialog).getByText(/240,00/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Onayla' }))
    expect(
      await screen.findByRole('heading', { name: 'Sipariş SIP2026000001' }),
    ).toBeInTheDocument()
    expect(db.calls.find((c) => c.path === `/sales-orders/${ORDER_DRAFT}/confirm`)?.body).toEqual({
      version: 2,
    })
  })

  it('opens the credit override dialog on a block and confirms with a reason', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales(`/sales/orders/${ORDER_DRAFT}`)
    await openConfirm(user)
    const dialog = await screen.findByRole('dialog', { name: 'Kredi limiti aşılıyor' })
    const breakdown = within(dialog).getByLabelText('Risk dökümü')
    expect(breakdown).toHaveTextContent('1.000,00')
    expect(breakdown).toHaveTextContent('1.220,00')
    expect(breakdown).toHaveTextContent('120,00')
    await user.type(within(dialog).getByLabelText(/Aşım gerekçesi/), 'Yönetim onayı alındı')
    await user.click(within(dialog).getByRole('button', { name: 'Limiti aşarak onayla' }))
    expect(
      await screen.findByRole('heading', { name: 'Sipariş SIP2026000001' }),
    ).toBeInTheDocument()
    const confirms = db.calls.filter((c) => c.path === `/sales-orders/${ORDER_DRAFT}/confirm`)
    expect(confirms.map((c) => c.body)).toEqual([
      { version: 1 },
      { version: 1, credit_override_reason: 'Yönetim onayı alındı' },
    ])
    expect(screen.getByText(/Kredi limiti aşılarak onaylandı/)).toBeInTheDocument()
  })

  it('explains the block to users without the override permission', async () => {
    setupSales({ permissions: without('sales.credit_override') })
    const user = userEvent.setup()
    renderSales(`/sales/orders/${ORDER_DRAFT}`)
    await openConfirm(user)
    const dialog = await screen.findByRole('dialog', { name: 'Kredi limiti aşılıyor' })
    expect(within(dialog).getByText(/Limit aşımını onaylama yetkiniz yok/)).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: 'Limiti aşarak onayla' }),
    ).not.toBeInTheDocument()
  })

  it('reuses the idempotency key when a confirm is retried after a lost response', async () => {
    const db = setupSales({ db: { creditMode: 'off', dropNext: ['/sales-orders/confirm'] } })
    const user = userEvent.setup()
    renderSales(`/sales/orders/${ORDER_DRAFT}`)
    await openConfirm(user)
    // The response was lost: the dialog stays for a retry.
    const dialog = await screen.findByRole('alertdialog', { name: 'Sipariş onaylansın mı?' })
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Onayla' })).toBeEnabled(),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Onayla' }))
    expect(
      await screen.findByRole('heading', { name: 'Sipariş SIP2026000001' }),
    ).toBeInTheDocument()
    const keys = db.calls
      .filter((c) => c.path === `/sales-orders/${ORDER_DRAFT}/confirm`)
      .map((c) => c.headers.get('Idempotency-Key'))
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    // Confirmed once: the replay did not bump the version again.
    expect(db.orders.find((o) => o.id === ORDER_DRAFT)?.version).toBe(2)
  })

  it('sends large orders for approval and shows the approval state', async () => {
    setupSales({ db: { creditMode: 'off', approvalOver: '100' } })
    const user = userEvent.setup()
    renderSales(`/sales/orders/${ORDER_DRAFT}`)
    await openConfirm(user)
    expect(await screen.findByText(/Sipariş onay bekliyor/)).toBeInTheDocument()
    expect(screen.getByText('Onay bekliyor', { selector: '[data-status]' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Onay süreci' }))
    expect(await screen.findByText('Satış müdürü')).toBeInTheDocument()
    // Only cancelling is left while approval runs.
    expect(screen.getByRole('button', { name: 'Siparişi iptal et' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'İrsaliye oluştur' })).not.toBeInTheDocument()
  })

  it('hides confirming without the update permission', async () => {
    setupSales({ permissions: ['sales.orders.view'] })
    renderSales(`/sales/orders/${ORDER_DRAFT}`)
    await screen.findByRole('table', { name: 'Satırlar' })
    expect(screen.getByText('Bu belgeyi düzenleme yetkiniz yok.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Onayla' })).not.toBeInTheDocument()
  })
})

describe('order fulfilment', () => {
  it('keeps the wizard open while creating and reuses the key after a lost response', async () => {
    const db = setupSales({
      db: { dropNext: ['/sales-orders/deliveries'], delay: { '/sales-orders/deliveries': 400 } },
    })
    const user = userEvent.setup()
    const { router } = renderSales(`/sales/orders/${ORDER_CONFIRMED}`)
    await screen.findByRole('heading', { name: 'Sipariş SIP2026000002' })
    const create = async () => {
      await user.click(screen.getByRole('button', { name: 'İrsaliye oluştur' }))
      const dialog = await screen.findByRole('dialog', { name: 'SIP2026000002 için irsaliye' })
      await user.click(within(dialog).getByRole('button', { name: 'İleri' }))
      await user.click(
        await within(dialog).findByRole('button', { name: 'Taslak irsaliye oluştur' }),
      )
      return dialog
    }
    const dialog = await create()
    // Pending: Escape and the close button do not dismiss the dialog.
    await user.keyboard('{Escape}')
    await user.click(within(dialog).getByRole('button', { name: 'Kapat' }))
    expect(screen.getByRole('dialog', { name: 'SIP2026000002 için irsaliye' })).toBeInTheDocument()
    // The response is lost; the user closes the wizard and tries again with the same quantities.
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await create()
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/sales\/deliveries\/d-new-/),
    )
    const keys = db.calls
      .filter((c) => c.path === `/sales-orders/${ORDER_CONFIRMED}/deliveries`)
      .map((c) => c.headers.get('Idempotency-Key'))
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
    // One delivery only: the retry was replayed.
    const order = db.orders.find((x) => x.id === ORDER_CONFIRMED)
    expect(
      order?.links?.filter((l) => l.type === 'sales_delivery' && l.id.startsWith('d-new-')),
    ).toHaveLength(1)
  })

  it('creates a partial delivery bounded by the remaining quantity', async () => {
    // The tolerance setting is readable (settings.view): the wizard bounds by it.
    const db = setupSales({
      permissions: [...ALL_SALES_PERMISSIONS, 'settings.view'],
      db: { settingsReadable: true },
    })
    const user = userEvent.setup()
    const { router } = renderSales(`/sales/orders/${ORDER_CONFIRMED}`)
    await screen.findByRole('heading', { name: 'Sipariş SIP2026000002' })
    // The chain shows the source quote and the posted delivery.
    const chain = screen.getByRole('list', { name: 'Belge zinciri' })
    expect(within(chain).getByText(/Teklif TKL2026000000/)).toBeInTheDocument()
    expect(within(chain).getByRole('link', { name: /İrsaliye IRS2026000001/ })).toHaveAttribute(
      'href',
      '/sales/deliveries/d-1',
    )
    // Partially delivered: no revise, no cancel.
    expect(screen.queryByRole('button', { name: 'Revize et' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Siparişi iptal et' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'İrsaliye oluştur' }))
    const dialog = await screen.findByRole('dialog', { name: 'SIP2026000002 için irsaliye' })
    const bolt = within(dialog).getByLabelText('Miktar: CVT-01 · Cıvata M8')
    expect(bolt).toHaveValue('6')
    await user.click(bolt)
    await user.keyboard('{Control>}a{/Control}7')
    await user.tab()
    expect(within(dialog).getByText('En çok 6 girilebilir.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'İleri' }))
    expect(within(dialog).getByText('Adım 1/2 · Miktarlar')).toBeInTheDocument()

    await user.click(bolt)
    await user.keyboard('{Control>}a{/Control}3')
    // Service lines are not delivered: no default, input disabled.
    const service = within(dialog).getByLabelText('Miktar: MNT-01 · Montaj hizmeti')
    expect(service).toHaveValue('')
    expect(service).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'İleri' }))
    expect(await within(dialog).findByText('Adım 2/2 · Tarih ve özet')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Taslak irsaliye oluştur' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/sales\/deliveries\/d-new-/),
    )
    const call = db.calls.find((c) => c.path === `/sales-orders/${ORDER_CONFIRMED}/deliveries`)
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(call?.body).toMatchObject({
      warehouse_id: 'wh-main',
      lines: [{ order_line_id: `${ORDER_CONFIRMED}-l1`, quantity: '3.000000' }],
    })
  })

  it('invoices delivered stock and services, and offers deliver-on-invoice for the rest', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales(`/sales/orders/${ORDER_CONFIRMED}`)
    await screen.findByRole('heading', { name: 'Sipariş SIP2026000002' })
    await user.click(screen.getByRole('button', { name: 'Fatura oluştur' }))
    const dialog = await screen.findByRole('dialog', { name: 'SIP2026000002 için fatura' })
    // 4 delivered, 1 invoiced: 3 left; the service line is invoiceable without delivery.
    expect(within(dialog).getByLabelText('Miktar: CVT-01 · Cıvata M8')).toHaveValue('3')
    expect(within(dialog).getByLabelText('Miktar: MNT-01 · Montaj hizmeti')).toHaveValue('2')
    await user.click(within(dialog).getByRole('checkbox', { name: /faturayla birlikte sevk et/ }))
    expect(within(dialog).getByLabelText('Miktar: CVT-01 · Cıvata M8')).toHaveValue('9')
    await user.click(within(dialog).getByRole('button', { name: 'İleri' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Taslak fatura oluştur' }))
    await waitFor(() =>
      expect(db.calls.some((c) => c.path === `/sales-orders/${ORDER_CONFIRMED}/invoices`)).toBe(
        true,
      ),
    )
    expect(
      db.calls.find((c) => c.path === `/sales-orders/${ORDER_CONFIRMED}/invoices`)?.body,
    ).toMatchObject({
      deliver_on_invoice: true,
      lines: [
        { order_line_id: `${ORDER_CONFIRMED}-l1`, quantity: '9' },
        { order_line_id: `${ORDER_CONFIRMED}-l2`, quantity: '2' },
      ],
    })
  })

  it('revises a confirmed order before deliveries and cancels it', async () => {
    const db = setupSales({ db: { creditMode: 'off' } })
    const order = db.orders.find((o) => o.id === ORDER_DRAFT)
    if (order) order.status = 'confirmed'
    const user = userEvent.setup()
    renderSales(`/sales/orders/${ORDER_DRAFT}`)
    await screen.findByRole('heading', { name: 'Sipariş SIP2026000001' })
    await user.click(screen.getByRole('button', { name: 'Revize et' }))
    const table = await screen.findByRole('table', { name: 'Satırlar' })
    expect(
      screen.getByRole('heading', { name: 'Sipariş SIP2026000001 revizyonu' }),
    ).toBeInTheDocument()
    await user.click(within(table).getByLabelText('Miktar, 1. satır'))
    await user.keyboard('{Control>}a{/Control}8')
    await user.click(screen.getByRole('button', { name: 'Revizyonu kaydet' }))
    expect(
      await screen.findByRole('heading', { name: 'Sipariş SIP2026000001' }),
    ).toBeInTheDocument()
    const revise = db.calls.find((c) => c.path === `/sales-orders/${ORDER_DRAFT}/revise`)
    expect(revise?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(revise?.body).toMatchObject({
      version: 1,
      lines: [expect.objectContaining({ quantity: '8.000000' })],
    })

    await user.click(screen.getByRole('button', { name: 'Siparişi iptal et' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sipariş iptal edilsin mi?' })
    await user.click(within(dialog).getByRole('button', { name: 'Siparişi iptal et' }))
    expect(
      await screen.findByText('İptal edildi', { selector: '[data-status]' }),
    ).toBeInTheDocument()
    // The API takes no cancellation reason.
    expect(db.calls.find((c) => c.path === `/sales-orders/${ORDER_DRAFT}/cancel`)?.body).toEqual({
      version: 2,
    })
  })

  it('lets an approver without the update permission revise', async () => {
    const db = setupSales({
      db: { creditMode: 'off' },
      permissions: without('sales.orders.update'),
    })
    const order = db.orders.find((o) => o.id === ORDER_DRAFT)
    if (order) order.status = 'confirmed'
    const user = userEvent.setup()
    renderSales(`/sales/orders/${ORDER_DRAFT}`)
    await screen.findByRole('heading', { name: 'Sipariş SIP2026000001' })
    await user.click(screen.getByRole('button', { name: 'Revize et' }))
    const table = await screen.findByRole('table', { name: 'Satırlar' })
    const qty = within(table).getByLabelText('Miktar, 1. satır')
    expect(qty).toBeEnabled()
    await user.click(qty)
    await user.keyboard('{Control>}a{/Control}8')
    await user.click(screen.getByRole('button', { name: 'Revizyonu kaydet' }))
    expect(
      await screen.findByRole('heading', { name: 'Sipariş SIP2026000001' }),
    ).toBeInTheDocument()
    expect(db.calls.some((c) => c.path === `/sales-orders/${ORDER_DRAFT}/revise`)).toBe(true)
  })

  it('closes an order in progress with the version only', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales(`/sales/orders/${ORDER_CONFIRMED}`)
    await screen.findByRole('heading', { name: 'Sipariş SIP2026000002' })
    await user.click(screen.getByRole('button', { name: 'Siparişi kapat' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sipariş kapatılsın mı?' })
    await user.click(within(dialog).getByRole('button', { name: 'Siparişi kapat' }))
    expect(await screen.findByText('Kapandı', { selector: '[data-status]' })).toBeInTheDocument()
    const close = db.calls.find((c) => c.path === `/sales-orders/${ORDER_CONFIRMED}/close`)
    expect(close?.body).toEqual({ version: 1 })
    expect(close?.headers.get('Idempotency-Key')).toBeTruthy()
  })

  it('needs sales.orders.approve to confirm, revise or close', async () => {
    setupSales({ permissions: ALL_SALES_PERMISSIONS.filter((p) => p !== 'sales.orders.approve') })
    renderSales(`/sales/orders/${ORDER_CONFIRMED}`)
    await screen.findByRole('heading', { name: 'Sipariş SIP2026000002' })
    expect(screen.getByRole('button', { name: 'İrsaliye oluştur' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Siparişi kapat' })).not.toBeInTheDocument()
  })

  it('leaves the stored lines out of a header-only save', async () => {
    const db = setupSales({ db: { creditMode: 'off' } })
    const user = userEvent.setup()
    renderSales(`/sales/orders/${ORDER_DRAFT}`)
    await screen.findByRole('table', { name: 'Satırlar' })
    const [notes] = screen.getAllByLabelText(/^Notlar/)
    if (!notes) throw new Error('notes field missing')
    await user.type(notes, 'Kapıda teslim')
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() => expect(db.calls.some((c) => c.method === 'PATCH')).toBe(true))
    const patch = db.calls.find((c) => c.method === 'PATCH')?.body as Record<string, unknown>
    expect(patch).toMatchObject({ notes: 'Kapıda teslim', version: 1 })
    expect(patch).not.toHaveProperty('lines')
  })
})
