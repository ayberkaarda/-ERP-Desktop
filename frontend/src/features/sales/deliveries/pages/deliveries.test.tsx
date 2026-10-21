import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DELIVERY_DRAFT, DELIVERY_POSTED, ORDER_1 } from '@/test/handlers/salesDocs'
import { renderSales, setupSales } from '../../invoices/kit/testing'
import type { DeliveryFromOrderInput } from '../types'
import './DeliveryListPage'
import './DeliveryPage'

vi.setConfig({ testTimeout: 20_000 })

describe('delivery list', () => {
  beforeEach(() => window.localStorage.clear())

  it('lists deliveries with status and passes filters from the URL', async () => {
    const db = setupSales()
    renderSales('/sales/deliveries?filter[status]=posted')
    const grid = await screen.findByRole('grid', { name: 'Sevk irsaliyeleri' })
    expect(await within(grid).findByText('IRS2026000001')).toBeInTheDocument()
    expect(within(grid).getByText('Sevk edildi')).toBeInTheDocument()
    const call = db.calls.filter((c) => c.method === 'GET' && c.path === '/sales-deliveries').at(-1)
    expect(call?.url.searchParams.get('filter[status]')).toBe('posted')
    expect(screen.getByRole('link', { name: /Doğrudan sevk/ })).toBeInTheDocument()
  })

  it('hides creation without the create permission and blocks the page without view', async () => {
    setupSales({ permissions: ['sales.deliveries.view'] })
    const first = renderSales('/sales/deliveries')
    await screen.findByRole('grid', { name: 'Sevk irsaliyeleri' })
    expect(screen.queryByRole('link', { name: /Doğrudan sevk/ })).not.toBeInTheDocument()
    first.unmount()

    setupSales({ permissions: ['sales.invoices.view'] })
    renderSales('/sales/deliveries')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()
  })
})

describe('delivery editor', () => {
  it('starts from the order, splits a lot line by FEFO, skips a line and saves a draft', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    const { router } = renderSales(`/sales/deliveries/new?order=${ORDER_1}`)
    await screen.findByRole('heading', { name: 'Yeni sevk irsaliyesi' })
    expect(screen.getByTestId('delivery-party')).toHaveTextContent('Acme Ticaret A.Ş.')
    const table = screen.getByRole('table', { name: 'İrsaliye satırları' })
    // Remaining = ordered 10 − delivered 4; the service line is not delivered.
    expect(within(table).getByLabelText('Miktar, 1. satır')).toHaveValue('6')
    expect(within(table).getByTestId('remaining-0')).toHaveTextContent('Kalan 6')
    expect(within(table).queryByText(/Montaj/)).not.toBeInTheDocument()

    // The phone line is left out of this partial delivery.
    const phoneQty = within(table).getByLabelText('Miktar, 2. satır')
    await user.clear(phoneQty)
    await user.type(phoneQty, '0')
    await user.tab()

    await user.click(
      within(table).getByRole('button', {
        name: '1. satır için ilk son kullanma tarihli lotları öner',
      }),
    )
    // L-A (20 days) 2, L-B (40 days) 3, undated L-N 1; the expired L-X is skipped.
    await waitFor(() => expect(within(table).getByLabelText('Lot, 1. satır')).toHaveValue('L-A'))
    expect(within(table).getByLabelText('Lot, 2. satır')).toHaveValue('L-B')
    expect(within(table).getByLabelText('Lot, 3. satır')).toHaveValue('L-N')
    expect(within(table).getByLabelText('Miktar, 3. satır')).toHaveValue('1')
    expect(await screen.findByText('Son kullanma tarihi geçmiş 1 lot atlandı.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales/deliveries/delivery-1'))
    const post = db.calls.find(
      (c) => c.method === 'POST' && c.path === `/sales-orders/${ORDER_1}/deliveries`,
    )
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    const body = post?.body as DeliveryFromOrderInput
    expect(body.lines).toEqual([
      {
        order_line_id: 'ol-1',
        quantity: '2',
        warehouse_id: null,
        lot_no: 'L-A',
        serial_numbers: [],
      },
      {
        order_line_id: 'ol-1',
        quantity: '3',
        warehouse_id: null,
        lot_no: 'L-B',
        serial_numbers: [],
      },
      {
        order_line_id: 'ol-1',
        quantity: '1',
        warehouse_id: null,
        lot_no: 'L-N',
        serial_numbers: [],
      },
    ])
  })

  it('requires serials for serial-tracked lines', async () => {
    setupSales()
    const user = userEvent.setup()
    renderSales(`/sales/deliveries/new?order=${ORDER_1}`)
    const table = await screen.findByRole('table', { name: 'İrsaliye satırları' })
    const lot = within(table).getByLabelText('Lot, 1. satır')
    await user.type(lot, 'L-A')
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    expect(await within(table).findByText('2 seri gerekli, 0 girildi.')).toBeInTheDocument()

    const serialButton = within(table).getByRole('button', { name: 'Seri numaraları, 2. satır' })
    expect(serialButton).toHaveTextContent('0 / 2 seri')
    await user.click(serialButton)
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Seri numaraları'), 'SN1{Enter}SN1')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('SN1')
    await user.clear(within(dialog).getByLabelText('Seri numaraları'))
    await user.type(within(dialog).getByLabelText('Seri numaraları'), 'SN1{Enter}SN2')
    expect(within(dialog).getByTestId('serial-count')).toHaveTextContent('2 / 2')
    await user.click(within(dialog).getByRole('button', { name: 'Uygula' }))
    expect(serialButton).toHaveTextContent('2 / 2 seri')
  })

  it('posts after confirmation and reuses the Idempotency-Key when retrying a lost response', async () => {
    const db = setupSales()
    db.failNext[`/sales-deliveries/${DELIVERY_DRAFT}/post`] = 1
    const user = userEvent.setup()
    renderSales(`/sales/deliveries/${DELIVERY_DRAFT}`)
    await screen.findByRole('heading', { name: 'Sevk irsaliyesi (taslak)' })

    const postOnce = async () => {
      await user.click(screen.getByRole('button', { name: 'Sevk et' }))
      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent('1 satır')
      await user.click(within(dialog).getByRole('button', { name: 'Sevk et' }))
    }
    await postOnce()
    await waitFor(() =>
      expect(
        db.calls.filter((c) => c.path === `/sales-deliveries/${DELIVERY_DRAFT}/post`),
      ).toHaveLength(1),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await postOnce()
    expect(await screen.findByTestId('assigned-number')).toHaveTextContent('IRS2026000001')
    const posts = db.calls.filter((c) => c.path === `/sales-deliveries/${DELIVERY_DRAFT}/post`)
    expect(posts).toHaveLength(2)
    expect(posts[0]?.headers.get('Idempotency-Key')).toBe(posts[1]?.headers.get('Idempotency-Key'))
    expect(posts[1]?.body).toEqual({ version: 1 })
  })

  it('offers a reload when someone else saved the draft first', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales(`/sales/deliveries/${DELIVERY_DRAFT}`)
    await screen.findByRole('heading', { name: 'Sevk irsaliyesi (taslak)' })
    const draft = db.deliveries.find((d) => d.id === DELIVERY_DRAFT)
    if (draft) draft.version = 7
    await user.type(screen.getByLabelText('Açıklama'), 'not')
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    const alert = await screen.findByText('Belge başka biri tarafından değiştirildi')
    expect(alert).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Güncel sürümü yükle' }))
    await waitFor(() =>
      expect(
        screen.queryByText('Belge başka biri tarafından değiştirildi'),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByLabelText('Açıklama')).toHaveValue('')
  })
})

describe('posted delivery', () => {
  it('links the COGS entry, creates the invoice draft and cancels with a reason', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales(`/sales/deliveries/${DELIVERY_POSTED}`)
    await screen.findByRole('heading', { name: 'Sevk irsaliyesi IRS2026000001' })
    expect(screen.getByRole('link', { name: 'Kaydı aç' })).toHaveAttribute(
      'href',
      '/accounting/journal-entries/je-cogs-1',
    )
    expect(screen.getByText('L-B')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'İptal et' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'İrsaliyeyi iptal et' }))
    expect(
      await within(dialog).findByText('En az 3 karakterlik bir neden yazın.'),
    ).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/Neden/), 'Yanlış sevk')
    await user.click(within(dialog).getByRole('button', { name: 'İrsaliyeyi iptal et' }))
    await waitFor(() =>
      expect(db.deliveries.find((d) => d.id === DELIVERY_POSTED)?.status).toBe('cancelled'),
    )
    const cancel = db.calls.find((c) => c.path === `/sales-deliveries/${DELIVERY_POSTED}/cancel`)
    expect(cancel?.body).toMatchObject({ version: 2, reason: 'Yanlış sevk' })
    expect(cancel?.headers.get('Idempotency-Key')).toBeTruthy()
  })

  it('creates an invoice draft from the delivery', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    const { router } = renderSales(`/sales/deliveries/${DELIVERY_POSTED}`)
    await user.click(await screen.findByRole('button', { name: 'Fatura oluştur' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales/invoices/invoice-1'))
    expect(db.calls.some((c) => c.path === `/sales-deliveries/${DELIVERY_POSTED}/invoice`)).toBe(
      true,
    )
  })

  it('hides cancel and invoice without their permissions', async () => {
    setupSales({ permissions: ['sales.deliveries.view'] })
    renderSales(`/sales/deliveries/${DELIVERY_POSTED}`)
    await screen.findByRole('heading', { name: 'Sevk irsaliyesi IRS2026000001' })
    expect(screen.queryByRole('button', { name: 'İptal et' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fatura oluştur' })).not.toBeInTheDocument()
    // Without the journal permission the entry is named, not linked.
    expect(screen.queryByRole('link', { name: 'Kaydı aç' })).not.toBeInTheDocument()
  })
})
