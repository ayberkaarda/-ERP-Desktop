import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ITEM_BOLT,
  PARTY_ACME,
  QUOTE_DRAFT,
  QUOTE_SENT,
  UNIT_BOX,
} from '../../shared/test/handlers'
import { renderSales, setupSales, ALL_SALES_PERMISSIONS } from '../../shared/test/testing'
import type { SalesDocumentInput } from '../../shared/types'
import './QuoteListPage'
import './QuotePage'

// Keyboard-driven flows through the real router are slow on a cold run.
vi.setConfig({ testTimeout: 30_000 })

type User = ReturnType<typeof userEvent.setup>

async function pick(user: User, input: HTMLElement, text: string, option: RegExp) {
  await user.click(input)
  await user.keyboard('{Control>}a{/Control}')
  await user.keyboard(text)
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('quote list', () => {
  beforeEach(() => window.localStorage.clear())

  it('lists quotes with status filter from the URL and exports the filtered list', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderSales('/sales/quotes?filter[status]=sent&filter[location_id]=x')
    const grid = await screen.findByRole('grid', { name: 'Satış teklifleri' })
    expect(await within(grid).findByText('TKL2026000002')).toBeInTheDocument()
    expect(within(grid).queryByText('TKL2026000001')).not.toBeInTheDocument()
    expect(within(grid).getByText('Gönderildi')).toBeInTheDocument()
    const list = db.calls.filter((c) => c.path === '/sales-quotes').at(-1)
    expect(list?.url.searchParams.get('filter[status]')).toBe('sent')
    // Unknown filters never reach the API.
    expect(list?.url.searchParams.has('filter[location_id]')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Excel' }))
    await waitFor(() => expect(db.calls.some((c) => c.path === '/sales-quotes/export')).toBe(true))
    const exp = db.calls.find((c) => c.path === '/sales-quotes/export')
    expect(exp?.url.searchParams.get('format')).toBe('xlsx')
    expect(exp?.url.searchParams.get('filter[status]')).toBe('sent')
    expect(exp?.url.searchParams.has('page')).toBe(false)
    await waitFor(() => expect(click).toHaveBeenCalled())
    click.mockRestore()
  })

  it('hides creating without the create permission and needs the view permission', async () => {
    setupSales({ permissions: ['sales.quotes.view'] })
    const first = renderSales('/sales/quotes')
    await screen.findByRole('grid', { name: 'Satış teklifleri' })
    expect(screen.queryByRole('link', { name: /Yeni teklif/ })).not.toBeInTheDocument()
    first.unmount()

    setupSales({ permissions: ['sales.orders.view'] })
    renderSales('/sales/quotes')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()
  })
})

describe('quote editor', () => {
  it('prices lines on the server (debounced), shows exposure and saves with an idempotency key', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    const { router } = renderSales('/sales/quotes/new')
    await screen.findByRole('heading', { name: 'Yeni Teklif' })

    await pick(user, screen.getByLabelText(/^Müşteri/), 'Acme', /Acme Makina/)
    const exposure = await screen.findByTestId('exposure')
    // Limit 1000, open invoices 500 and a confirmed order of 720 are already over the limit.
    expect(exposure).toHaveTextContent('Limit aşılıyor')

    const table = screen.getByRole('table', { name: 'Satırlar' })
    await pick(user, within(table).getByLabelText('Stok kartı, 1. satır'), 'Cıvata', /CVT-01/)
    const qty = within(table).getByLabelText('Miktar, 1. satır')
    await waitFor(() => expect(qty).toHaveValue('1'))
    await user.click(qty)
    await user.keyboard('{Control>}a{/Control}25')
    await user.tab()

    // Stock hint: 30 available in the main warehouse for 25 asked.
    await waitFor(() =>
      expect(within(table).getByTestId('stock-hint-0')).toHaveTextContent(
        'Kullanılabilir: 30 ADET (az)',
      ),
    )
    await waitFor(() => expect(screen.getByTestId('totals')).toHaveTextContent('300,00'))
    // 25 × 10,00 = 250 net + 20% VAT; typing did not send one request per key.
    expect(within(table).getByTestId('line-total-0')).toHaveTextContent('300,00')
    const previews = db.calls.filter((c) => c.path === '/sales-documents/preview-totals')
    expect(previews.length).toBeLessThanOrEqual(3)
    expect(
      (previews.at(-1)?.body as { lines: { quantity: string; unit_price: null }[] }).lines[0],
    ).toMatchObject({
      quantity: '25.000000',
      unit_price: null,
    })

    // A box is 12 pieces: the conversion is shown and the price follows.
    await pick(user, within(table).getByLabelText('Birim, 1. satır'), 'KOLI', /KOLI/)
    await waitFor(() =>
      expect(within(table).getByTestId('base-preview-0')).toHaveTextContent('= 300 ADET'),
    )
    await waitFor(() =>
      expect(within(table).getByTestId('stock-hint-0')).toHaveTextContent('Yetersiz stok'),
    )

    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/sales\/quotes\/q-new-/))
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/sales-quotes')
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    const body = post?.body as SalesDocumentInput
    expect(body).toMatchObject({ party_id: PARTY_ACME, currency_code: 'TRY' })
    expect(body.valid_until).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.lines).toEqual([
      expect.objectContaining({
        item_id: ITEM_BOLT,
        unit_id: UNIT_BOX,
        quantity: '25.000000',
        unit_price: null,
      }),
    ])
  })

  it('keeps prices locked without the override permission', async () => {
    setupSales({ permissions: ALL_SALES_PERMISSIONS.filter((p) => p !== 'sales.price_override') })
    renderSales(`/sales/quotes/${QUOTE_DRAFT}`)
    const table = await screen.findByRole('table', { name: 'Satırlar' })
    const price = within(table).getByLabelText('Birim fiyat, 1. satır')
    expect(price).toHaveAttribute('readonly')
    await waitFor(() => expect(price).toHaveValue('10,00'))
  })

  it('maps server field errors to the line cells and saves edits before sending', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales(`/sales/quotes/${QUOTE_DRAFT}`)
    const table = await screen.findByRole('table', { name: 'Satırlar' })
    // The server refuses the override even though the screen offered it.
    db.permissions = db.permissions.filter((p) => p !== 'sales.price_override')
    await user.click(within(table).getByLabelText('Birim fiyat, 1. satır'))
    await user.keyboard('9,5')
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    expect(await within(table).findByText('Fiyatı değiştirme yetkiniz yok.')).toBeInTheDocument()

    db.permissions.push('sales.price_override')
    await user.click(screen.getByRole('button', { name: 'Gönder' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Teklif gönderilsin mi?' })
    await user.click(within(dialog).getByRole('button', { name: 'Gönder' }))
    expect(await screen.findByRole('heading', { name: 'Teklif TKL2026000001' })).toBeInTheDocument()
    const patch = db.calls.find(
      (c) => c.method === 'PATCH' && c.path === `/sales-quotes/${QUOTE_DRAFT}`,
    )
    expect((patch?.body as SalesDocumentInput).lines[0]?.unit_price).toBe('9.5000')
    expect(db.calls.find((c) => c.path === `/sales-quotes/${QUOTE_DRAFT}/send`)?.body).toEqual({
      version: 2,
    })
  })

  it('offers a reload when someone else saved the draft first', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales(`/sales/quotes/${QUOTE_DRAFT}`)
    const table = await screen.findByRole('table', { name: 'Satırlar' })
    const stored = db.quotes.find((q) => q.id === QUOTE_DRAFT)
    if (stored) stored.version = 7
    await user.click(within(table).getByLabelText('Miktar, 1. satır'))
    await user.keyboard('{Control>}a{/Control}12')
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    expect(await screen.findByText('Belge başka biri tarafından değiştirildi')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Güncel hâlini yükle' }))
    await waitFor(() =>
      expect(
        screen.queryByText('Belge başka biri tarafından değiştirildi'),
      ).not.toBeInTheDocument(),
    )
    expect(within(table).getByLabelText('Miktar, 1. satır')).toHaveValue('10')
  })
})

describe('quote lifecycle', () => {
  it('sends a draft and then shows it read-only with its chain, audit and attachments', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales(`/sales/quotes/${QUOTE_DRAFT}`)
    await screen.findByRole('table', { name: 'Satırlar' })
    await user.click(screen.getByRole('button', { name: 'Gönder' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Teklif gönderilsin mi?' })
    await user.click(within(dialog).getByRole('button', { name: 'Gönder' }))
    expect(await screen.findByRole('heading', { name: 'Teklif TKL2026000001' })).toBeInTheDocument()
    const send = db.calls.find((c) => c.path === `/sales-quotes/${QUOTE_DRAFT}/send`)
    expect(send?.body).toEqual({ version: 1 })
    expect(send?.headers.get('Idempotency-Key')).toBeTruthy()
    // An unchanged draft is not saved again before sending.
    expect(db.calls.some((c) => c.method === 'PATCH')).toBe(false)
    expect(screen.getByText('Gönderildi', { selector: '[data-status]' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Belge zinciri' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Denetim kaydı' }))
    expect(await screen.findAllByText(/Deniz Kaya/)).not.toHaveLength(0)
  })

  it('rejects with a reason and converts an accepted quote into an order', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    const { router } = renderSales(`/sales/quotes/${QUOTE_SENT}`)
    await screen.findByRole('heading', { name: 'Teklif TKL2026000002' })

    await user.click(screen.getByRole('button', { name: 'Reddedildi' }))
    const reject = await screen.findByRole('dialog', { name: 'Teklif reddedildi mi?' })
    await user.click(within(reject).getByRole('button', { name: 'Reddedildi' }))
    expect(await within(reject).findByText('En az 3 karakter yazın.')).toBeInTheDocument()
    await user.click(within(reject).getByLabelText(/Ret gerekçesi/))
    await user.keyboard('Fiyat yüksek')
    await user.click(within(reject).getByRole('button', { name: 'Reddedildi' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(db.calls.find((c) => c.path === `/sales-quotes/${QUOTE_SENT}/reject`)?.body).toEqual({
      version: 1,
      reason: 'Fiyat yüksek',
    })
    // A rejected quote can only be revised: a new draft revision opens.
    await user.click(await screen.findByRole('button', { name: 'Revize et' }))
    const revise = await screen.findByRole('alertdialog', { name: 'Yeni revizyon açılsın mı?' })
    await user.click(within(revise).getByRole('button', { name: 'Revize et' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/sales\/quotes\/q-rev-/))
    const revision = db.quotes.find((q) => q.previous_revision_id === QUOTE_SENT)
    expect(revision).toMatchObject({ status: 'draft', revision: 1 })
  })

  it('converts a sent quote into an order and opens it', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    const { router } = renderSales(`/sales/quotes/${QUOTE_SENT}`)
    await screen.findByRole('heading', { name: 'Teklif TKL2026000002' })
    await user.click(screen.getByRole('button', { name: 'Siparişe dönüştür' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Siparişe dönüştürülsün mü?' })
    await user.click(within(dialog).getByRole('button', { name: 'Siparişe dönüştür' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/sales\/orders\/o-new-/))
    expect(db.quotes.find((q) => q.id === QUOTE_SENT)?.status).toBe('converted')
  })

  it('shows no lifecycle buttons without the update permission', async () => {
    setupSales({ permissions: ['sales.quotes.view'] })
    renderSales(`/sales/quotes/${QUOTE_SENT}`)
    await screen.findByRole('heading', { name: 'Teklif TKL2026000002' })
    expect(screen.queryByRole('button', { name: 'Kabul edildi' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Siparişe dönüştür' })).not.toBeInTheDocument()
  })
})
