import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { INVOICE_BOOKED, INVOICE_DRAFT } from '@/test/handlers/purchDocs'
import { ALL_PURCH2_PERMISSIONS, renderPurch, setupPurch } from '../kit/testing'
import '../../returns/pages/ReturnPage'
import './InvoicePage'

vi.setConfig({ testTimeout: 30_000 })

const BOOK_PATH = `/purchase-invoices/${INVOICE_DRAFT}/book`

describe('book dialog refusal lifecycle', () => {
  it('drops a refused match breakdown when the dialog is opened again', async () => {
    const db = setupPurch({ permissions: [...ALL_PURCH2_PERMISSIONS, 'purchasing.match_override'] })
    const user = userEvent.setup()
    renderPurch(`/purchasing/invoices/${INVOICE_DRAFT}`)
    await screen.findByRole('heading', { name: 'Alış faturası (taslak)' })
    await user.click(screen.getByRole('button', { name: 'Muhasebeleştir' }))
    let dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(/Uyarı modunda/)
    db.matchMode = 'block'
    await user.click(within(dialog).getByRole('button', { name: 'Muhasebeleştir' }))
    expect(await within(dialog).findByLabelText(/Fark onayı gerekçesi/)).toBeInTheDocument()

    // The company goes back to warn mode; a reopened dialog reads the fresh match.
    db.matchMode = 'warn'
    await user.click(within(dialog).getByRole('button', { name: 'Vazgeç' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Muhasebeleştir' }))
    dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/Uyarı modunda/)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/Fark onayı gerekçesi/)).not.toBeInTheDocument()
  })

  it('replays a booking whose response was lost after the server committed it', async () => {
    const db = setupPurch({ db: { failAfterCommit: { [BOOK_PATH]: 1 } } })
    const user = userEvent.setup()
    renderPurch(`/purchasing/invoices/${INVOICE_DRAFT}`)
    await screen.findByRole('heading', { name: 'Alış faturası (taslak)' })
    await user.click(screen.getByRole('button', { name: 'Muhasebeleştir' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText(/Uyarı modunda/)
    await user.click(within(dialog).getByRole('button', { name: 'Muhasebeleştir' }))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    // Booked on the server already; the retry must not book (or number) twice.
    expect(db.invoices.find((i) => i.id === INVOICE_DRAFT)?.status).toBe('booked')
    const number = db.invoices.find((i) => i.id === INVOICE_DRAFT)?.number
    await user.click(within(dialog).getByRole('button', { name: 'Muhasebeleştir' }))
    expect(await screen.findByTestId('assigned-number')).toHaveTextContent(number ?? 'x')
    const keys = db.calls
      .filter((c) => c.path === BOOK_PATH)
      .map((c) => c.headers.get('Idempotency-Key'))
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })
})

describe('create keys across remounts', () => {
  it('reuses the return create key after leaving the page following a lost response', async () => {
    const path = `/purchase-invoices/${INVOICE_BOOKED}/returns`
    const db = setupPurch({ db: { failAfterCommit: { [path]: 1 } } })
    const user = userEvent.setup()
    const before = db.returns.length

    const fill = async () => {
      await screen.findByRole('heading', { name: 'Yeni alış iadesi' })
      const table = screen.getByRole('table', { name: 'İade satırları' })
      await user.type(within(table).getByLabelText('1. satır iade miktarı'), '1')
      await user.type(within(table).getByLabelText('1. satır lot no'), 'L-1')
      await user.click(screen.getByRole('button', { name: 'İade taslağı oluştur' }))
    }

    const first = renderPurch(`/purchasing/returns/new?invoice=${INVOICE_BOOKED}`)
    await fill()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    first.unmount()

    const second = renderPurch(`/purchasing/returns/new?invoice=${INVOICE_BOOKED}`)
    await fill()
    await waitFor(() =>
      expect(second.router.state.location.pathname).toMatch(/^\/purchasing\/returns\/return-/),
    )
    const keys = db.calls
      .filter((c) => c.path === path)
      .map((c) => c.headers.get('Idempotency-Key'))
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
    expect(db.returns.length).toBe(before + 1)
  })

  it('shows receipt return bounds as upper bounds and refuses more', async () => {
    setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/returns/new?receipt=receipt-posted`)
    await screen.findByRole('heading', { name: 'Yeni alış iadesi' })
    const table = screen.getByRole('table', { name: 'İade satırları' })
    // Receipt bounds are upper bounds: invoices holding the receipt are deducted by the server.
    expect(within(table).getByTestId('returnable-1')).toHaveTextContent('en çok 4')
    await user.type(within(table).getByLabelText('1. satır iade miktarı'), '9')
    expect(within(table).getByText('İade edilebilir miktarı aşıyor')).toBeInTheDocument()
  })
})
