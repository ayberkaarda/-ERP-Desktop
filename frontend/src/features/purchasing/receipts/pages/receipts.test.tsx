import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ORDER_1, RECEIPT_DRAFT, RECEIPT_POSTED } from '@/test/handlers/purchDocs'
import { ALL_PURCH2_PERMISSIONS, renderPurch, setupPurch } from '../../invoices/kit/testing'
import './ReceiptListPage'
import './ReceiptPage'

vi.setConfig({ testTimeout: 30_000 })

describe('goods receipt editor', () => {
  beforeEach(() => window.localStorage.clear())

  it('requires lot, expiry and serials, saves them and posts the receipt', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/receipts/${RECEIPT_DRAFT}`)
    await screen.findByRole('heading', { name: 'Mal kabul (taslak)' })
    const table = screen.getByRole('table', { name: 'Mal kabul satırları' })
    expect(await within(table).findByTestId('remaining-0')).toHaveTextContent('açık 6')

    await user.click(screen.getByRole('button', { name: 'Kaydet ve stoğa al' }))
    expect(await screen.findAllByText('Lot takipli stok için lot no girin.')).not.toHaveLength(0)
    expect(db.calls.some((c) => c.method === 'PATCH')).toBe(false)

    await user.type(within(table).getByLabelText('Lot no, 1. satır'), 'L-7')
    await user.type(within(table).getByLabelText('Son kullanma, 1. satır'), '30.06.2027')
    await user.click(within(table).getByRole('button', { name: '2. satırın seri numaraları' }))
    const serials = await screen.findByRole('dialog')
    await user.type(within(serials).getByLabelText('Seri numaraları'), 'SN1{Enter}SN1')
    expect(within(serials).getByRole('alert')).toHaveTextContent('Tekrarlanan seri: SN1')
    await user.clear(within(serials).getByLabelText('Seri numaraları'))
    await user.type(within(serials).getByLabelText('Seri numaraları'), 'SN1{Enter}SN2')
    expect(within(serials).getByTestId('serial-count')).toHaveTextContent('2 / 2')
    await user.click(within(serials).getByRole('button', { name: 'Uygula' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Kaydet ve stoğa al' }))
    const post = await screen.findByRole('dialog')
    expect(within(post).getByText('Mal kabul kaydedilsin mi?')).toBeInTheDocument()
    const patch = db.calls.find((c) => c.method === 'PATCH')
    expect(patch?.body).toMatchObject({
      version: 1,
      warehouse_id: 'wh-main',
      lines: [
        {
          order_line_id: 'ol-bolt',
          quantity: '6.000000',
          lot_no: 'L-7',
          expiry_date: '2027-06-30',
          serial_numbers: [],
        },
        {
          order_line_id: 'ol-phone',
          quantity: '2.000000',
          lot_no: null,
          serial_numbers: ['SN1', 'SN2'],
        },
      ],
    })
    await user.click(within(post).getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByTestId('assigned-number')).toHaveTextContent('GRN2026000000010')
    const call = db.calls.find((c) => c.path === `/purchase-receipts/${RECEIPT_DRAFT}/post`)
    expect(call?.body).toEqual({ version: 2 })
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
  })

  it('splits a lot-tracked line for a second lot', async () => {
    setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/receipts/${RECEIPT_DRAFT}`)
    const table = await screen.findByRole('table', { name: 'Mal kabul satırları' })
    await user.click(within(table).getByRole('button', { name: '1. satırı başka lot için böl' }))
    expect(await within(table).findByLabelText('Lot no, 2. satır')).toHaveValue('')
    expect(within(table).getByLabelText('Miktar, 2. satır')).toHaveValue('')
  })

  it('creates a receipt for an order with only the lines given a quantity', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    const { router } = renderPurch(`/purchasing/receipts/new?order=${ORDER_1}`)
    await screen.findByRole('heading', { name: 'Yeni mal kabul' })
    const table = screen.getByRole('table', { name: 'Mal kabul satırları' })
    // The service line is not received; bolt has 6 open, the phones 2.
    expect(within(table).getByLabelText('Miktar, 1. satır')).toHaveValue('6')
    const phone = within(table).getByLabelText('Miktar, 2. satır')
    await user.clear(phone)
    await user.type(phone, '0')
    const bolt = within(table).getByLabelText('Miktar, 1. satır')
    await user.clear(bolt)
    await user.type(bolt, '7')
    await user.tab()
    expect(within(table).getByTestId('remaining-0')).toHaveTextContent('açık miktar 6 aşıldı')
    await user.clear(bolt)
    await user.type(bolt, '3')
    await user.type(within(table).getByLabelText('Lot no, 1. satır'), 'L-9')
    await user.type(within(table).getByLabelText('Son kullanma, 1. satır'), '31.12.2027')
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/purchasing\/receipts\/receipt-/),
    )
    const call = db.calls.find((c) => c.path === `/purchase-orders/${ORDER_1}/receipts`)
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(call?.body).toMatchObject({
      warehouse_id: 'wh-main',
      lines: [
        {
          order_line_id: 'ol-bolt',
          quantity: '3.000000',
          lot_no: 'L-9',
          expiry_date: '2027-12-31',
        },
      ],
    })
  })

  it('shows a read-only editor without the update right and no post button without post', async () => {
    setupPurch({ permissions: ['purchasing.receipts.view', 'purchasing.orders.view'] })
    renderPurch(`/purchasing/receipts/${RECEIPT_DRAFT}`)
    await screen.findByRole('heading', { name: 'Mal kabul (taslak)' })
    expect(screen.getByText(/salt okunur/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kaydet ve stoğa al' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Taslağı kaydet' })).not.toBeInTheDocument()
  })
})

describe('posted goods receipt', () => {
  it('shows lots, the stock and GRNI postings and reverses with a reason', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/receipts/${RECEIPT_POSTED}`)
    await screen.findByRole('heading', { name: 'Mal kabul GRN2026000000001' })
    expect(screen.getByText('L-1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Kaydı aç' })).toHaveAttribute(
      'href',
      '/accounting/journal-entries/je-grn-1',
    )
    expect(screen.getByRole('link', { name: 'Belgeyi aç' })).toHaveAttribute(
      'href',
      '/inventory/documents/sd-1',
    )
    expect(screen.getByRole('link', { name: /İade başlat/ })).toHaveAttribute(
      'href',
      `/purchasing/returns/new?receipt=${RECEIPT_POSTED}`,
    )

    await user.click(screen.getByRole('button', { name: 'Ters kayıt' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Ters kaydı oluştur' }))
    expect(
      await within(dialog).findByText('En az 3 karakterlik bir neden girin.'),
    ).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/Neden/), 'Yanlış depo')
    await user.click(within(dialog).getByRole('button', { name: 'Ters kaydı oluştur' }))
    await waitFor(() =>
      expect(db.receipts.find((r) => r.id === RECEIPT_POSTED)?.status).toBe('cancelled'),
    )
    const call = db.calls.find((c) => c.path === `/purchase-receipts/${RECEIPT_POSTED}/cancel`)
    expect(call?.body).toMatchObject({ version: 3, reason: 'Yanlış depo' })
    expect((call?.body as { date?: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('creates a draft invoice from the receipt and opens it', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    const { router } = renderPurch(`/purchasing/receipts/${RECEIPT_POSTED}`)
    await screen.findByRole('heading', { name: 'Mal kabul GRN2026000000001' })
    await user.click(screen.getByRole('button', { name: 'Fatura oluştur' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Tedarikçi fatura no'), 'TDR-500')
    await user.click(within(dialog).getByRole('button', { name: 'Taslak fatura oluştur' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/purchasing\/invoices\/invoice-/),
    )
    const call = db.calls.find((c) => c.path === `/purchase-receipts/${RECEIPT_POSTED}/invoice`)
    expect(call?.body).toMatchObject({ supplier_invoice_no: 'TDR-500' })
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
  })

  it('hides reversal, invoicing and return actions without their permissions', async () => {
    setupPurch({ permissions: ['purchasing.receipts.view'] })
    renderPurch(`/purchasing/receipts/${RECEIPT_POSTED}`)
    await screen.findByRole('heading', { name: 'Mal kabul GRN2026000000001' })
    expect(screen.queryByRole('button', { name: 'Ters kayıt' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fatura oluştur' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /İade başlat/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Kaydı aç' })).not.toBeInTheDocument()
  })

  it('lists receipts with their source', async () => {
    setupPurch({ permissions: ALL_PURCH2_PERMISSIONS })
    renderPurch('/purchasing/receipts')
    const grid = await screen.findByRole('grid', { name: 'Mal kabulleri' })
    const row = (await within(grid).findByText('GRN2026000000001')).closest('tr')
    if (!row) throw new Error('row')
    expect(within(row).getByText('IRS-77')).toBeInTheDocument()
    expect(within(row).getByText('Kaydedildi')).toBeInTheDocument()
  })
})
