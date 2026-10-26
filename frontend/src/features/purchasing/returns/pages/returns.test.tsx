import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { INVOICE_BOOKED, RETURN_DRAFT } from '@/test/handlers/purchDocs'
import { renderPurch, setupPurch } from '../../invoices/kit/testing'
import './ReturnListPage'
import './ReturnPage'

vi.setConfig({ testTimeout: 30_000 })

describe('purchase return creation', () => {
  it('bounds quantities by what is still returnable and creates a draft from the invoice', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    const { router } = renderPurch(`/purchasing/returns/new?invoice=${INVOICE_BOOKED}`)
    await screen.findByRole('heading', { name: 'Yeni alış iadesi' })
    const table = screen.getByRole('table', { name: 'İade satırları' })
    // 4 invoiced, 1 already on a draft return.
    const row = within(table).getByText('BOLT Cıvata M8').closest('tr')
    if (!row) throw new Error('row')
    expect(within(row).getByText('3')).toBeInTheDocument()

    const qty = within(table).getByLabelText('1. satır iade miktarı')
    await user.type(qty, '4')
    expect(await within(table).findByText('İade edilebilir miktarı aşıyor')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'İade taslağı oluştur' }))
    expect(db.calls.some((c) => c.path.endsWith('/returns') && c.method === 'POST')).toBe(false)

    await user.clear(qty)
    await user.type(qty, '2')
    await user.type(within(table).getByLabelText('1. satır lot no'), 'L-1')
    expect(screen.getByTestId('return-value')).toHaveTextContent('100,00 TRY')
    await user.click(screen.getByRole('button', { name: 'İade taslağı oluştur' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/purchasing\/returns\/return-/),
    )
    const call = db.calls.find((c) => c.path === `/purchase-invoices/${INVOICE_BOOKED}/returns`)
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(call?.body).toMatchObject({
      lines: [
        { invoice_line_id: 'ib-bolt', quantity: '2.000000', lot_no: 'L-1', serial_numbers: [] },
      ],
    })
  })
})

describe('purchase return steps', () => {
  it('approves, ships and issues the debit note, each with an idempotency key', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/returns/${RETURN_DRAFT}`)
    await screen.findByRole('heading', { name: /^Alış iadesi/ })

    const step = async (button: string) => {
      await user.click(screen.getByRole('button', { name: button }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: button }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
    await step('Onayla')
    expect(
      await screen.findByRole('heading', { name: 'Alış iadesi PRT2026000000010' }),
    ).toBeInTheDocument()
    await step('Sevk et')
    await waitFor(() =>
      expect(db.returns.find((r) => r.id === RETURN_DRAFT)?.status).toBe('shipped'),
    )
    await step('Borç dekontu kes')
    expect(await screen.findByTestId('debit-note-link')).toHaveTextContent('PDN2026000000010')
    for (const action of ['approve', 'ship', 'debit']) {
      const call = db.calls.find((c) => c.path === `/purchase-returns/${RETURN_DRAFT}/${action}`)
      expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    }
  })

  it('replays a step with the same key after a lost response', async () => {
    const path = `/purchase-returns/${RETURN_DRAFT}/approve`
    const db = setupPurch({ db: { failNext: { [path]: 1 } } })
    const user = userEvent.setup()
    renderPurch(`/purchasing/returns/${RETURN_DRAFT}`)
    await screen.findByRole('heading', { name: /^Alış iadesi/ })
    await user.click(screen.getByRole('button', { name: 'Onayla' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Onayla' }))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Onayla' }))
    await waitFor(() =>
      expect(db.returns.find((r) => r.id === RETURN_DRAFT)?.status).toBe('approved'),
    )
    const keys = db.calls
      .filter((c) => c.path === path)
      .map((c) => c.headers.get('Idempotency-Key'))
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  it('offers only the steps the user may take', async () => {
    setupPurch({ permissions: ['purchasing.returns.view', 'purchasing.returns.approve'] })
    renderPurch(`/purchasing/returns/${RETURN_DRAFT}`)
    await screen.findByRole('heading', { name: /^Alış iadesi/ })
    expect(screen.getByRole('button', { name: 'Onayla' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'İadeyi iptal et' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Taslağı sil' })).not.toBeInTheDocument()
  })
})
