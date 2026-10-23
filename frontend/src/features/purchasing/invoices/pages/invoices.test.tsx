import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { INVOICE_BOOKED, INVOICE_DRAFT } from '@/test/handlers/purchDocs'
import { MatchPanel } from '../components/MatchPanel'
import { ALL_PURCH2_PERMISSIONS, renderPurch, setupPurch } from '../kit/testing'
import { parseMatch } from '../lib/match'
import './InvoiceListPage'
import './InvoicePage'

vi.setConfig({ testTimeout: 20_000 })

const BOOK_PATH = `/purchase-invoices/${INVOICE_DRAFT}/book`

const lines = [
  { id: 'a', line_no: 1, item_code: 'BOLT', item_name: 'Cıvata', description: null },
  { id: 'b', line_no: 2, item_code: 'PHN', item_name: 'Telefon', description: null },
  { id: 'c', line_no: 3, item_code: 'SRV', item_name: 'Montaj', description: null },
]

function matchOf(status: string, mode = 'warn', extra: Record<string, unknown> = {}) {
  const m = parseMatch({
    mode,
    status,
    ...extra,
    lines: [
      {
        invoice_line_id: 'a',
        status: 'qty_variance',
        line_no: 1,
        order_line_id: 'ol1',
        ordered: '10',
        received: '4',
        invoiced: '6',
        reference: '4',
        order_price: '50',
        invoice_price: '50',
        price_difference_percent: '0',
        qty_tolerance_percent: '0',
        price_tolerance_percent: '0',
      },
      {
        invoice_line_id: 'b',
        status: 'price_variance',
        line_no: 2,
        order_line_id: 'ol2',
        ordered: '2',
        received: '2',
        invoiced: '2',
        reference: '2',
        order_price: '1000',
        invoice_price: '1100',
        price_difference_percent: '10',
        qty_tolerance_percent: '0',
        price_tolerance_percent: '2',
      },
      { invoice_line_id: 'c', status: 'unmatched', line_no: 3, reason: 'no_order' },
    ],
  })
  if (!m) throw new Error('match')
  return m
}

describe('match panel', () => {
  it('highlights the quantity or price cell that is beyond its tolerance', () => {
    render(<MatchPanel match={matchOf('qty_variance')} lines={lines} />)
    const panel = screen.getByTestId('match-panel')
    const qtyRow = within(panel).getByTestId('match-line-1')
    expect(qtyRow.querySelector('[data-variance="qty"]')).toHaveTextContent('6')
    expect(qtyRow.querySelector('[data-variance="price"]')).toBeNull()
    expect(within(qtyRow).getByText('miktar toleransı aşıldı')).toHaveClass('sr-only')
    const priceRow = within(panel).getByTestId('match-line-2')
    expect(priceRow.querySelector('[data-variance="price"]')).toHaveTextContent('1.100,00')
    expect(priceRow.querySelector('[data-variance="qty"]')).toBeNull()
    expect(within(priceRow).getByText('%10')).toBeInTheDocument()
    const noOrder = within(panel).getByTestId('match-line-3')
    expect(within(noOrder).getByText('Siparişe bağlı değil; eşleştirme dışı.')).toBeInTheDocument()
    expect(within(panel).getByTestId('match-count-unmatched')).toHaveTextContent('Siparişsiz: 1')
    expect(within(panel).getByText('Uyar')).toBeInTheDocument()
  })

  it('shows a clean match, the off mode and a recorded override', () => {
    const clean = parseMatch({
      mode: 'off',
      status: 'matched',
      override_reason: 'Fiyat artışı sözleşmede var',
      lines: [
        {
          invoice_line_id: 'a',
          status: 'matched',
          line_no: 1,
          order_line_id: 'ol1',
          ordered: '4',
          received: '4',
          invoiced: '4',
          reference: '4',
          order_price: '50',
          invoice_price: '50',
          price_difference_percent: '0',
          qty_tolerance_percent: '0',
          price_tolerance_percent: '0',
        },
      ],
    })
    render(<MatchPanel match={clean} lines={lines} />)
    const panel = screen.getByTestId('match-panel')
    expect(panel.querySelector('[data-variance]')).toBeNull()
    expect(
      within(panel).getByText('Eşleştirme kapalı: farklar kaydı etkilemez.'),
    ).toBeInTheDocument()
    expect(within(panel).getByRole('note')).toHaveTextContent('Fiyat artışı sözleşmede var')
    expect(within(panel).getAllByText('Eşleşti').length).toBeGreaterThan(0)
  })

  it('says when there is no match yet', () => {
    render(<MatchPanel match={null} lines={lines} />)
    expect(screen.getByText('Eşleştirme bilgisi yok.')).toBeInTheDocument()
  })
})

describe('supplier invoice booking', () => {
  beforeEach(() => window.localStorage.clear())

  it('books in warn mode with the live match shown and assigns the number', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/invoices/${INVOICE_DRAFT}`)
    await screen.findByRole('heading', { name: 'Alış faturası (taslak)' })
    // 55 invoiced against a 50 order price: a price variance on the live match of the draft.
    const panel = await screen.findByTestId('match-panel')
    expect(await within(panel).findByTestId('match-count-price_variance')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Muhasebeleştir' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Uyarı modunda fatura yine de kaydedilir/)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/Fark onayı gerekçesi/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Muhasebeleştir' }))
    expect(await screen.findByTestId('assigned-number')).toHaveTextContent('PIN2026000000010')
    const call = db.calls.find((c) => c.path === BOOK_PATH)
    expect(call?.body).toEqual({ version: 2 })
    expect(db.invoices.find((i) => i.id === INVOICE_DRAFT)?.status).toBe('booked')
  })

  it('in block mode without the override right explains why and cannot book', async () => {
    setupPurch({ db: { matchMode: 'block' } })
    const user = userEvent.setup()
    renderPurch(`/purchasing/invoices/${INVOICE_DRAFT}`)
    await screen.findByRole('heading', { name: 'Alış faturası (taslak)' })
    await user.click(screen.getByRole('button', { name: 'Muhasebeleştir' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/farkı onaylama yetkiniz yok/)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/Fark onayı gerekçesi/)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Farkı onayla ve kaydet' })).toBeDisabled()
  })

  it('in block mode with purchasing.match_override requires a reason and sends it', async () => {
    const db = setupPurch({
      permissions: [...ALL_PURCH2_PERMISSIONS, 'purchasing.match_override'],
      db: { matchMode: 'block' },
    })
    const user = userEvent.setup()
    renderPurch(`/purchasing/invoices/${INVOICE_DRAFT}`)
    await screen.findByRole('heading', { name: 'Alış faturası (taslak)' })
    await user.click(screen.getByRole('button', { name: 'Muhasebeleştir' }))
    const dialog = await screen.findByRole('dialog')
    const reason = await within(dialog).findByLabelText(/Fark onayı gerekçesi/)
    await user.type(reason, 'kısa')
    await user.click(within(dialog).getByRole('button', { name: 'Farkı onayla ve kaydet' }))
    expect(await within(dialog).findByText('Gerekçe en az 5 karakter olmalı.')).toBeInTheDocument()
    expect(db.calls.some((c) => c.path === BOOK_PATH)).toBe(false)

    await user.type(reason, ' — sözleşme ek fiyatı')
    await user.click(within(dialog).getByRole('button', { name: 'Farkı onayla ve kaydet' }))
    expect(await screen.findByTestId('assigned-number')).toBeInTheDocument()
    const call = db.calls.find((c) => c.path === BOOK_PATH)
    expect(call?.body).toEqual({ version: 2, match_override_reason: 'kısa — sözleşme ek fiyatı' })
    expect(db.invoices.find((i) => i.id === INVOICE_DRAFT)?.match_override_reason).toBe(
      'kısa — sözleşme ek fiyatı',
    )
  })

  it('switches to the override form when the server refuses with purchasing.match_failed', async () => {
    const db = setupPurch({ permissions: [...ALL_PURCH2_PERMISSIONS, 'purchasing.match_override'] })
    const user = userEvent.setup()
    renderPurch(`/purchasing/invoices/${INVOICE_DRAFT}`)
    await screen.findByRole('heading', { name: 'Alış faturası (taslak)' })
    await user.click(screen.getByRole('button', { name: 'Muhasebeleştir' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(/Uyarı modunda/)
    // The company switched to block mode after the dialog read the match.
    db.matchMode = 'block'
    await user.click(within(dialog).getByRole('button', { name: 'Muhasebeleştir' }))
    expect(await within(dialog).findByLabelText(/Fark onayı gerekçesi/)).toBeInTheDocument()
    expect(within(dialog).getByText('Engelle')).toBeInTheDocument()
    expect(db.invoices.find((i) => i.id === INVOICE_DRAFT)?.status).toBe('draft')
  })

  it('reuses the idempotency key when the same book request is retried after a lost response', async () => {
    const db = setupPurch({ db: { failNext: { [BOOK_PATH]: 1 } } })
    const user = userEvent.setup()
    renderPurch(`/purchasing/invoices/${INVOICE_DRAFT}`)
    await screen.findByRole('heading', { name: 'Alış faturası (taslak)' })
    await user.click(screen.getByRole('button', { name: 'Muhasebeleştir' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(/Uyarı modunda/)
    await user.click(within(dialog).getByRole('button', { name: 'Muhasebeleştir' }))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Muhasebeleştir' }))
    expect(await screen.findByTestId('assigned-number')).toBeInTheDocument()
    const keys = db.calls
      .filter((c) => c.path === BOOK_PATH)
      .map((c) => c.headers.get('Idempotency-Key'))
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
  })
})

describe('supplier invoice permissions and view', () => {
  it('locks sourced prices without price_override and hides booking without the book right', async () => {
    setupPurch({ permissions: ['purchasing.invoices.view', 'purchasing.invoices.update'] })
    renderPurch(`/purchasing/invoices/${INVOICE_DRAFT}`)
    const table = await screen.findByRole('table', { name: 'Fatura satırları' })
    expect(within(table).getByLabelText('Birim fiyat, 1. satır')).toBeDisabled()
    expect(within(table).getByLabelText('Miktar, 1. satır')).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Muhasebeleştir' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Taslağı kaydet' })).toBeInTheDocument()
  })

  it('shows payable, withholding, balance due and the journal link of a booked invoice', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/invoices/${INVOICE_BOOKED}`)
    await screen.findByRole('heading', { name: 'Alış faturası PIN2026000000007' })
    // 200 net + 40 VAT = 240; 5/10 withholding of the VAT = 20; payable 220.
    expect(screen.getByTestId('doc-total')).toHaveTextContent('240,00 TRY')
    expect(screen.getByTestId('doc-withholding')).toHaveTextContent('20,00 TRY')
    expect(screen.getByTestId('payable')).toHaveTextContent('220,00 TRY')
    expect(screen.getByTestId('balance-due')).toHaveTextContent('220,00 TRY')
    expect(screen.getByRole('link', { name: 'Kaydı aç' })).toHaveAttribute(
      'href',
      '/accounting/journal-entries/je-pin-7',
    )
    expect(screen.getByRole('link', { name: /İade başlat/ })).toHaveAttribute(
      'href',
      `/purchasing/returns/new?invoice=${INVOICE_BOOKED}`,
    )

    await user.click(screen.getByRole('button', { name: 'Ters kayıt' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Neden/), 'Yanlış tedarikçi')
    await user.click(within(dialog).getByRole('button', { name: 'Ters kaydı oluştur' }))
    await waitFor(() =>
      expect(db.invoices.find((i) => i.id === INVOICE_BOOKED)?.status).toBe('reversed'),
    )
    const call = db.calls.find((c) => c.path === `/purchase-invoices/${INVOICE_BOOKED}/reverse`)
    expect(call?.body).toMatchObject({
      version: 4,
      reason: 'Yanlış tedarikçi',
      reverse_stock: false,
    })
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
  })

  it('hides reverse, return and the journal link for a view-only user', async () => {
    setupPurch({ permissions: ['purchasing.invoices.view'] })
    renderPurch(`/purchasing/invoices/${INVOICE_BOOKED}`)
    await screen.findByRole('heading', { name: 'Alış faturası PIN2026000000007' })
    expect(screen.queryByRole('button', { name: 'Ters kayıt' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /İade başlat/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Kaydı aç' })).not.toBeInTheDocument()
    expect(screen.getByText('Kaydı aç')).toBeInTheDocument()
  })

  it('lists invoices with the match state and filters open balances', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch('/purchasing/invoices')
    const grid = await screen.findByRole('grid', { name: 'Alış faturaları' })
    const row = (await within(grid).findByText('PIN2026000000007')).closest('tr')
    if (!row) throw new Error('row')
    expect(within(row).getByText('TDR-2026-090')).toBeInTheDocument()
    expect(within(row).getByText('Eşleşti')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Yalnız açık bakiyeli'))
    await waitFor(() =>
      expect(
        db.calls
          .filter((c) => c.path === '/purchase-invoices')
          .at(-1)
          ?.url.searchParams.get('filter[open]'),
      ).toBe('1'),
    )
  })

  it('denies the page without purchasing.invoices.view', async () => {
    setupPurch({ permissions: ['purchasing.receipts.view'] })
    renderPurch('/purchasing/invoices')
    expect(await screen.findByText(/yetki/i)).toBeInTheDocument()
    expect(screen.queryByRole('grid', { name: 'Alış faturaları' })).not.toBeInTheDocument()
  })
})
