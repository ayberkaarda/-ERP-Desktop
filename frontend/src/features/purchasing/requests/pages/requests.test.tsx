import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { REQ_APPROVED, REQ_DRAFT, SUP_BETA } from '../../shared/test/handlers'
import { renderPurch, setupPurch, without } from '../../shared/test/testing'
import './RequestListPage'
import './RequestPage'

vi.setConfig({ testTimeout: 30_000 })

type User = ReturnType<typeof userEvent.setup>

async function typeInto(user: User, el: HTMLElement, text: string) {
  await user.click(el)
  await user.keyboard('{Control>}a{/Control}')
  await user.keyboard(text)
}

describe('purchase requests', () => {
  it('lists requests with the suggested-supplier filter', async () => {
    setupPurch()
    renderPurch('/purchasing/requests')
    const grid = await screen.findByRole('grid', { name: 'Satınalma talepleri' })
    expect(await within(grid).findByText('PRQ2026000000001')).toBeInTheDocument()
    expect(screen.getByText('Önerilen tedarikçi')).toBeInTheDocument()
  })

  it('creates a draft with an idempotency key and decimal-string estimates', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    const { router } = renderPurch('/purchasing/requests/new')
    const table = await screen.findByRole('table', { name: 'Satırlar' })
    await user.type(within(table).getByLabelText('Stok kartı, 1. satır'), 'Cıvata')
    await user.click(await screen.findByRole('option', { name: /Cıvata M8/ }))
    await typeInto(user, within(table).getByLabelText('Miktar, 1. satır'), '3')
    await typeInto(user, within(table).getByLabelText('Tahmini fiyat, 1. satır'), '0,1')
    expect(screen.getByTestId('estimated-total')).toHaveTextContent('0,30')
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/purchasing\/requests\/r-new-/),
    )
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/purchase-requests')
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    expect((post?.body as { lines: unknown[] }).lines[0]).toMatchObject({
      quantity: '3.000000',
      estimated_price: '0.100000',
    })
  })

  it('says the request left draft when it was submitted meanwhile, and saves a rejected one', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/requests/${REQ_DRAFT}`)
    const table = await screen.findByRole('table', { name: 'Satırlar' })
    const stored = db.requests.find((r) => r.id === REQ_DRAFT)
    if (stored) stored.status = 'pending_approval'
    await typeInto(user, within(table).getByLabelText('Miktar, 1. satır'), '4')
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    expect(await screen.findByText('Belge artık taslak değil')).toBeInTheDocument()
    expect(screen.queryByText('Belge başka biri tarafından değiştirildi')).not.toBeInTheDocument()

    // A rejected request is edited like a draft (RequestService, manifest draft_only.also).
    if (stored) stored.status = 'rejected'
    await user.click(screen.getByRole('button', { name: 'Güncel hâlini yükle' }))
    await waitFor(() =>
      expect(screen.queryByText('Belge artık taslak değil')).not.toBeInTheDocument(),
    )
    await typeInto(user, within(table).getByLabelText('Miktar, 1. satır'), '5')
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() => expect(stored?.status).toBe('draft'))
    expect(screen.queryByText('Belge artık taslak değil')).not.toBeInTheDocument()
  })

  it('submits a draft and sends it for approval above the threshold', async () => {
    const db = setupPurch({ db: { requestApprovalOver: '50' } })
    const user = userEvent.setup()
    renderPurch(`/purchasing/requests/${REQ_DRAFT}`)
    await screen.findByRole('table', { name: 'Satırlar' })
    await user.click(screen.getByRole('button', { name: 'Onaya gönder' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Talep onaya gönderilsin mi?' })
    await user.click(within(dialog).getByRole('button', { name: 'Onaya gönder' }))
    expect(await screen.findByText(/Belge onay bekliyor/)).toBeInTheDocument()
    expect(db.calls.find((c) => c.path === `/purchase-requests/${REQ_DRAFT}/submit`)?.body).toEqual(
      { version: 1 },
    )
  })

  it('creates an order draft bounded by the open request quantity', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    const { router } = renderPurch(`/purchasing/requests/${REQ_APPROVED}`)
    await screen.findByRole('heading', { name: 'Talep PRQ2026000000001' })
    await user.click(screen.getByRole('button', { name: 'Sipariş oluştur' }))
    const dialog = await screen.findByRole('dialog', { name: 'PRQ2026000000001 için sipariş' })
    const bolt = within(dialog).getByLabelText('CVT-01 · Cıvata M8 miktarı')
    // 10 requested - 4 already on orders.
    expect(bolt).toHaveValue('6')
    await typeInto(user, bolt, '7')
    expect(within(dialog).getByText('En fazla 6 girilebilir.')).toBeInTheDocument()
    await typeInto(user, bolt, '5')
    await user.click(within(dialog).getByRole('button', { name: 'Taslak sipariş oluştur' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/purchasing\/orders\/o-new-/),
    )
    const call = db.calls.find((c) => c.path === `/purchase-requests/${REQ_APPROVED}/orders`)
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    // The single suggested supplier is preselected; prices default to the estimates.
    expect(call?.body).toMatchObject({
      party_id: 'sup-acme',
      lines: [
        { request_line_id: `${REQ_APPROVED}-l1`, quantity: '5.000000', unit_price: '9.5' },
        { request_line_id: `${REQ_APPROVED}-l2`, quantity: '2', unit_price: '25' },
      ],
    })
  })

  it('creates an RFQ for the chosen suppliers', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    const { router } = renderPurch(`/purchasing/requests/${REQ_APPROVED}`)
    await screen.findByRole('heading', { name: 'Talep PRQ2026000000001' })
    await user.click(screen.getByRole('button', { name: 'Teklif talebi oluştur' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'PRQ2026000000001 için teklif talebi',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Taslak teklif talebi oluştur' }))
    expect(within(dialog).getByText('En az bir tedarikçi seçin.')).toBeInTheDocument()
    await user.type(
      within(dialog).getByRole('combobox', { name: /Davet edilen tedarikçiler/ }),
      'Beta',
    )
    await user.click(await screen.findByRole('option', { name: /Beta Endüstri/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Taslak teklif talebi oluştur' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/purchasing\/rfqs\/q-new-/),
    )
    expect(
      db.calls.find((c) => c.path === `/purchase-requests/${REQ_APPROVED}/rfq`)?.body,
    ).toMatchObject({
      supplier_ids: [SUP_BETA],
      currency_code: 'TRY',
    })
  })

  it('shows conversions and state changes only with their permissions', async () => {
    setupPurch({ permissions: without('purchasing.rfqs.create', 'purchasing.requests.update') })
    renderPurch(`/purchasing/requests/${REQ_APPROVED}`)
    await screen.findByRole('heading', { name: 'Talep PRQ2026000000001' })
    expect(screen.getByRole('button', { name: 'Sipariş oluştur' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Teklif talebi oluştur' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Talebi iptal et' })).not.toBeInTheDocument()
  })
})
