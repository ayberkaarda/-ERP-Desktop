import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { INVOICE_ISSUED, RETURN_DRAFT } from '@/test/handlers/salesDocs'
import { renderSales, setupSales } from '../../invoices/kit/testing'
import type { ReturnInput } from '../types'
import './ReturnListPage'
import './ReturnPage'

vi.setConfig({ testTimeout: 20_000 })

describe('return from an invoice', () => {
  it('selects lines within the returnable quantity and creates the draft', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    const { router } = renderSales(`/sales/returns/new?invoice=${INVOICE_ISSUED}`)
    await screen.findByRole('heading', { name: 'Yeni satış iadesi' })
    const table = screen.getByRole('table', { name: 'Fatura satırları' })
    // 10 invoiced − 3 already returned; the fully returned service line cannot be picked.
    const boltRow = within(table).getByLabelText('BOLT · Cıvata M8 satırını seç').closest('tr')
    if (!boltRow) throw new Error('row')
    expect(within(boltRow).getByText('7')).toBeInTheDocument()
    expect(within(table).getByLabelText('SRV · Montaj satırını seç')).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'İade taslağı oluştur' }))
    expect(await screen.findByText('İade edilecek en az bir satır seçin.')).toBeInTheDocument()

    await user.click(within(table).getByLabelText('BOLT · Cıvata M8 satırını seç'))
    const qty = within(table).getByLabelText('BOLT · Cıvata M8 iade miktarı')
    await user.clear(qty)
    await user.type(qty, '8')
    await user.tab()
    await user.click(screen.getByRole('button', { name: 'İade taslağı oluştur' }))
    expect(await within(table).findByText('İade edilebilir miktarı aşıyor.')).toBeInTheDocument()

    await user.clear(qty)
    await user.type(qty, '2')
    await user.type(within(table).getByLabelText('BOLT · Cıvata M8 iade nedeni'), 'Kırık')
    await user.tab()
    expect(screen.getByTestId('return-summary')).toHaveTextContent('1 satır seçildi · 200,00 TRY')
    await user.click(screen.getByRole('button', { name: 'İade taslağı oluştur' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales/returns/return-1'))
    const call = db.calls.find((c) => c.path === `/sales-invoices/${INVOICE_ISSUED}/returns`)
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    expect((call?.body as ReturnInput).lines).toEqual([
      {
        invoice_line_id: 'il-1',
        quantity: '2.000000',
        reason: 'Kırık',
        lot_no: null,
        serial_numbers: [],
      },
    ])
    expect((call?.body as ReturnInput).warehouse_id).toBe('wh-main')
  })

  it('explains that returns start from an invoice', async () => {
    setupSales()
    renderSales('/sales/returns/new')
    expect(
      await screen.findByText('İade, kesilmiş bir faturanın sayfasından başlatılır.'),
    ).toBeInTheDocument()
  })
})

describe('return steps', () => {
  it('approves, receives and credits, linking the credit note', async () => {
    const db = setupSales()
    const user = userEvent.setup()
    renderSales(`/sales/returns/${RETURN_DRAFT}`)
    await screen.findByRole('heading', { name: 'Satış iadesi IA2026000002' })

    const step = async (button: string, confirm: string) => {
      await user.click(await screen.findByRole('button', { name: button }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: confirm }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }
    await step('Onayla', 'Onayla')
    await step('Teslim al', 'Teslim al')
    await step('İade faturası kes', 'İade faturasını kes')
    expect(await screen.findByRole('link', { name: 'IF2026000001' })).toHaveAttribute(
      'href',
      '/sales/invoices/invoice-credit',
    )
    const actions = db.calls.filter((c) => c.path.startsWith(`/sales-returns/${RETURN_DRAFT}/`))
    expect(actions.map((c) => c.path.split('/').at(-1))).toEqual(['approve', 'receive', 'credit'])
    expect(actions.map((c) => (c.body as { version: number }).version)).toEqual([1, 2, 3])
    expect((actions[1]?.body as { date?: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Set(actions.map((c) => c.headers.get('Idempotency-Key'))).size).toBe(3)
  })

  it('shows no step without its permission', async () => {
    setupSales({ permissions: ['sales.returns.view'] })
    renderSales(`/sales/returns/${RETURN_DRAFT}`)
    await screen.findByRole('heading', { name: 'Satış iadesi IA2026000002' })
    expect(screen.queryByRole('button', { name: 'Onayla' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'İadeyi iptal et' })).not.toBeInTheDocument()
  })

  it('lists returns with their invoice', async () => {
    setupSales()
    renderSales('/sales/returns')
    const grid = await screen.findByRole('grid', { name: 'Satış iadeleri' })
    expect(await within(grid).findByText('IA2026000002')).toBeInTheDocument()
    expect(within(grid).getByRole('link', { name: 'SF2026000007' })).toHaveAttribute(
      'href',
      `/sales/invoices/${INVOICE_ISSUED}`,
    )
  })
})
