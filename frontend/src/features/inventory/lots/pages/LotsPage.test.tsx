import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LOT_OLD } from '@/test/handlers/inventoryStock'
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
    const grid = await screen.findByRole('grid', { name: 'Partiler' })
    const old = (await within(grid).findByRole('link', { name: 'L-2401' })).closest(
      'tr',
    ) as HTMLElement
    expect(within(old).getByText('Süresi doldu')).toBeInTheDocument()
    const fresh = within(grid).getByRole('link', { name: 'L-2402' }).closest('tr') as HTMLElement
    expect(within(fresh).getByText('10 gün kaldı')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Son kullanma'), 'expired')
    await waitFor(() =>
      expect(within(grid).queryByRole('link', { name: 'L-2402' })).not.toBeInTheDocument(),
    )
    const call = db.calls.filter((c) => c.path === '/stock-lots').at(-1)
    expect(call?.url.searchParams.get('filter[expiry_status]')).toBe('expired')
  })

  it('traces a lot: received, issued, where it is and its movements', async () => {
    setupInventoryStock()
    const user = userEvent.setup()
    const { router } = renderInventoryStock('/inventory/lots')
    await user.click(await screen.findByRole('link', { name: 'L-2401' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/inventory/lots/${LOT_OLD}`))
    expect(await screen.findByRole('heading', { name: 'L-2401 partisi' })).toBeInTheDocument()
    const figures = screen.getByText('Giren').closest('dl') as HTMLElement
    expect(within(figures).getByText('10')).toBeInTheDocument()
    expect(within(figures).getByText('4')).toBeInTheDocument()
    const where = screen.getByRole('table', { name: 'Şu an nerede' })
    expect(within(where).getByText('Merkez depo')).toBeInTheDocument()
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
    expect(await screen.findByText('Parti bulunamadı.')).toBeInTheDocument()
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
    expect(within(unit).getByText('A-01', { exact: false })).toBeInTheDocument()
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
