import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RES_ACTIVE } from '@/test/handlers/inventoryDocs'
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

    await user.click(within(grid).getByRole('button', { name: 'Serbest bırak: STK-001' }))
    const dialog = await screen.findByRole('dialog', { name: 'Rezervasyon serbest bırakılsın mı?' })
    expect(dialog).toHaveTextContent('STK-001 · Cıvata M8 için 12 ADET')
    await user.type(within(dialog).getByLabelText(/Gerekçe/), 'Sipariş iptal')
    await user.click(within(dialog).getByRole('button', { name: 'Serbest bırak' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const call = db.calls.find((c) => c.path === `/stock-reservations/${RES_ACTIVE}/release`)
    expect(call?.body).toEqual({ version: 1, reason: 'Sipariş iptal' })
    await waitFor(() => expect(within(grid).queryByText('SIP-2026-000004')).not.toBeInTheDocument())
  })

  it('opens for stock viewers without the release action', async () => {
    setupInvDocs({ permissions: ['inventory.stock.view'] })
    renderInvDocs('/inventory/reservations')
    const grid = await screen.findByRole('grid', { name: 'Rezervasyonlar' })
    expect(await within(grid).findByText('SIP-2026-000004')).toBeInTheDocument()
    expect(within(grid).queryByRole('button', { name: /Serbest bırak/ })).not.toBeInTheDocument()
  })

  it('is forbidden without stock view or manage', async () => {
    setupInvDocs({ permissions: ['inventory.documents.view'] })
    renderInvDocs('/inventory/reservations')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()
  })
})
