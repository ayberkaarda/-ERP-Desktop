import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ITEM_BOLT, RES_ACTIVE, WH_MAIN } from '@/test/handlers/inventoryDocs'
import { renderInvDocs, setupInvDocs } from '../../documents/testing'
import './ReservationListPage'

vi.setConfig({ testTimeout: 20_000 })

describe('stock reservations', () => {
  beforeEach(() => window.localStorage.clear())

  it('lists active reservations and releases one', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    renderInvDocs('/inventory/reservations')
    const grid = await screen.findByRole('grid', { name: 'Rezervasyonlar' })
    expect(await within(grid).findByText('SIP-2026-000004')).toBeInTheDocument()
    // Active ones by default.
    expect(within(grid).queryByText('SIP-2026-000005')).not.toBeInTheDocument()
    const list = db.calls.filter((c) => c.path === '/stock-reservations').at(-1)
    expect(list?.url.searchParams.get('filter[status]')).toBe('active')

    await user.click(await within(grid).findByRole('button', { name: 'Serbest bırak: STK-001' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rezervasyon serbest bırakılsın mı?' })
    expect(dialog).toHaveTextContent('STK-001 · Cıvata M8 için 12 ADET')
    await user.click(within(dialog).getByRole('button', { name: 'Serbest bırak' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const call = db.calls.find((c) => c.path === `/stock-reservations/${RES_ACTIVE}/release`)
    expect(call?.body).toEqual({ version: 1 })
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    await waitFor(() => expect(within(grid).queryByText('SIP-2026-000004')).not.toBeInTheDocument())
  })

  it('creates a reservation and reports a shortage', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    renderInvDocs('/inventory/reservations')
    await screen.findByRole('grid', { name: 'Rezervasyonlar' })
    await user.click(screen.getByRole('button', { name: 'Yeni rezervasyon' }))
    const dialog = await screen.findByRole('dialog', { name: 'Stok rezerve et' })
    await user.type(within(dialog).getByLabelText(/^Stok kartı/), 'STK-001')
    await user.click(await screen.findByRole('option', { name: /STK-001 · Cıvata M8/ }))
    await user.type(within(dialog).getByLabelText(/^Depo/), 'ANA')
    await user.click(await screen.findByRole('option', { name: 'ANA · Ana depo' }))
    await user.click(within(dialog).getByLabelText(/^Miktar/))
    await user.keyboard('10')
    await user.type(within(dialog).getByLabelText(/^Notlar/), 'Fuar stoğu')
    await user.click(within(dialog).getByRole('button', { name: 'Rezerve et' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const call = db.calls.find((c) => c.method === 'POST' && c.path === '/stock-reservations')
    expect(call?.body).toEqual({
      item_id: ITEM_BOLT,
      warehouse_id: WH_MAIN,
      lot_id: null,
      quantity: '10.000000',
      expires_at: null,
      notes: 'Fuar stoğu',
    })
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    // 7 on hand: 3 over the available stock under the soft policy.
    expect(await screen.findByText(/3 kullanılabilir stoğu aşıyor/)).toBeInTheDocument()
  })

  it('opens for stock viewers without the release action', async () => {
    setupInvDocs({ permissions: ['inventory.stock.view'] })
    renderInvDocs('/inventory/reservations')
    const grid = await screen.findByRole('grid', { name: 'Rezervasyonlar' })
    expect(await within(grid).findByText('SIP-2026-000004')).toBeInTheDocument()
    expect(within(grid).queryByRole('button', { name: /Serbest bırak/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yeni rezervasyon' })).not.toBeInTheDocument()
  })

  it('is forbidden without stock view or manage', async () => {
    setupInvDocs({ permissions: ['inventory.documents.view'] })
    renderInvDocs('/inventory/reservations')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()
  })
})
