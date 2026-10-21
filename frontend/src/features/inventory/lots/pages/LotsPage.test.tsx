import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInventoryStockDb, LOT_OLD } from '@/test/handlers/inventoryStock'
import { renderInventoryStock, setupInventoryStock } from '../../stock/testing'
import './LotsPage'
import './LotTracePage'
import './SerialsPage'

vi.setConfig({ testTimeout: 20_000 })

describe('lots', () => {
  it('lists lots with expiry badges and filters expired ones', async () => {
    const db = setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock('/inventory/lots')
    const grid = await screen.findByRole('grid', { name: 'Lotlar' })
    const old = (await within(grid).findByRole('link', { name: 'L-2401' })).closest(
      'tr',
    ) as HTMLElement
    expect(within(old).getByText('Süresi doldu')).toBeInTheDocument()
    const fresh = within(grid).getByRole('link', { name: 'L-2402' }).closest('tr') as HTMLElement
    expect(within(fresh).getByText('10 gün kaldı')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Yalnızca süresi dolmuşlar'))
    await waitFor(() =>
      expect(within(grid).queryByRole('link', { name: 'L-2402' })).not.toBeInTheDocument(),
    )
    const call = db.calls.filter((c) => c.path === '/stock-lots').at(-1)
    expect(call?.url.searchParams.get('filter[expired]')).toBe('true')
    expect(call?.url.searchParams.get('sort')).toBe('expiry_date')
    // Lots have no export endpoint.
    expect(screen.queryByRole('button', { name: 'CSV' })).not.toBeInTheDocument()
  })

  it('sends the expiry date and stock filters TraceController knows', async () => {
    const db = setupInventoryStock()
    renderInventoryStock(
      '/inventory/lots?filter[expires_before]=2099-01-01&filter[with_stock]=true&filter[expiry_status]=expired',
    )
    const grid = await screen.findByRole('grid', { name: 'Lotlar' })
    expect(await within(grid).findByRole('link', { name: 'L-2402' })).toBeInTheDocument()
    const call = db.calls.filter((c) => c.path === '/stock-lots').at(-1)
    expect(call?.url.searchParams.get('filter[expires_before]')).toBe('2099-01-01')
    expect(call?.url.searchParams.get('filter[with_stock]')).toBe('true')
    expect(call?.url.searchParams.has('filter[expiry_status]')).toBe(false)
    expect(screen.getByLabelText('Yalnızca stokta olanlar')).toBeChecked()
  })

  it('traces a lot: received, issued, where it is and its movements', async () => {
    setupInventoryStock()
    const user = userEvent.setup()
    const { router } = renderInventoryStock('/inventory/lots')
    await user.click(await screen.findByRole('link', { name: 'L-2401' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/inventory/lots/${LOT_OLD}`))
    expect(await screen.findByRole('heading', { name: 'L-2401 lotu' })).toBeInTheDocument()
    const figures = screen.getByText('Giren', { selector: 'dt' }).closest('dl') as HTMLElement
    expect(within(figures).getByText('10')).toBeInTheDocument()
    expect(within(figures).getByText('4')).toBeInTheDocument()
    const where = screen.getByRole('table', { name: 'Şu an nerede' })
    expect(within(where).getByText('Merkez depo', { exact: false })).toBeInTheDocument()
    expect(within(where).getByText('MRK')).toBeInTheDocument()
    const history = screen.getByRole('table', { name: 'Hareket geçmişi' })
    expect(within(history).getByText('CKS-2026-000001')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Stok defterinde göster/ })).toHaveAttribute(
      'href',
      `/inventory/movements?filter[lot_id]=${LOT_OLD}`,
    )
  })

  it('reports an unknown lot', async () => {
    setupInventoryStock()
    renderInventoryStock('/inventory/lots/nope')
    expect(await screen.findByText('Lot bulunamadı.')).toBeInTheDocument()
  })
})

describe('serials', () => {
  it('lists serial units with status and opens a unit history', async () => {
    const db = setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock('/inventory/serials')
    const grid = await screen.findByRole('grid', { name: 'Seri numaraları' })
    const unit = (await within(grid).findByText('MTK-0001')).closest('tr') as HTMLElement
    expect(within(unit).getByText('Stokta')).toBeInTheDocument()
    expect(within(unit).getByText('MRK')).toBeInTheDocument()
    expect(within(grid).getByText('Çıkışı yapıldı')).toBeInTheDocument()

    await user.click(within(unit).getByRole('button', { name: 'MTK-0001 geçmişini aç' }))
    expect(await screen.findByRole('dialog', { name: 'MTK-0001 geçmişi' })).toBeInTheDocument()
    await waitFor(() =>
      expect(
        db.calls.some(
          (c) =>
            c.path === '/stock-movements' && c.url.searchParams.get('filter[serial_id]') === 'sn-1',
        ),
      ).toBe(true),
    )
  })
})

describe('serial history paging', () => {
  it('loads a long serial history page by page instead of truncating it', async () => {
    const base = createInventoryStockDb().movements[0]
    if (!base) throw new Error('fixture has no movements')
    const movements = Array.from({ length: 150 }, (_, i) => ({
      ...base,
      id: `mv-sn-${i + 1}`,
      seq: i + 1,
      serial_id: 'sn-1',
      serial_no: 'MTK-0001',
    }))
    const db = setupInventoryStock({ db: { movements } })
    const user = userEvent.setup()
    renderInventoryStock('/inventory/serials')
    const grid = await screen.findByRole('grid', { name: 'Seri numaraları' })
    const unit = (await within(grid).findByText('MTK-0001')).closest('tr') as HTMLElement
    await user.click(within(unit).getByRole('button', { name: 'MTK-0001 geçmişini aç' }))
    const drawer = await screen.findByRole('dialog', { name: 'MTK-0001 geçmişi' })
    expect(await within(drawer).findByText('100 hareket yüklendi')).toBeInTheDocument()
    await user.click(within(drawer).getByRole('button', { name: 'Daha fazla yükle' }))
    expect(await within(drawer).findByText('150 hareket yüklendi')).toBeInTheDocument()
    expect(
      within(drawer).queryByRole('button', { name: 'Daha fazla yükle' }),
    ).not.toBeInTheDocument()
    const calls = db.calls.filter(
      (c) =>
        c.path === '/stock-movements' && c.url.searchParams.get('filter[serial_id]') === 'sn-1',
    )
    expect(calls.at(-1)?.url.searchParams.get('cursor')).toBe('51')
  })
})
