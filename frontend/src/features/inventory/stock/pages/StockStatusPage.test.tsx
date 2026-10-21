import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ITEM_BOLT } from '@/test/handlers/catalog'
import { WH_SHOP } from '@/test/handlers/inventoryStock'
import { renderInventoryStock, setupInventoryStock } from '../testing'
import './StockStatusPage'

vi.setConfig({ testTimeout: 20_000 })

const lastList = (db: ReturnType<typeof setupInventoryStock>) =>
  db.calls.filter((c) => c.method === 'GET' && c.path === '/stock-balances').at(-1)

describe('stock status page', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
  })

  it('shows item x warehouse balances from decimal strings, negatives marked', async () => {
    const db = setupInventoryStock()
    renderInventoryStock('/inventory/stock')
    const grid = await screen.findByRole('grid', { name: 'Stok durumu' })
    const bolt = (await within(grid).findByText('Cıvata M8')).closest('tr') as HTMLElement
    // Two lot rows of the bolt merge into one item x warehouse row.
    expect(within(bolt).getByText('1.256,5')).toBeInTheDocument()
    expect(within(bolt).getByText('1.056,5')).toBeInTheDocument()
    expect(within(bolt).getByText('3.141,25')).toBeInTheDocument()
    const glove = within(grid).getByText('İş eldiveni').closest('tr') as HTMLElement
    expect(within(glove).getAllByText('-2')[0]).toHaveClass('text-danger')
    expect(screen.getByTestId('stock-total-value')).toHaveTextContent('3.126,75')
    expect(lastList(db)?.url.searchParams.get('group_by')).toBe('item_warehouse')
  })

  it('filters by warehouse and below reorder point, groups by lot with expiry badges', async () => {
    const db = setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock('/inventory/stock')
    const grid = await screen.findByRole('grid', { name: 'Stok durumu' })
    await within(grid).findByText('Cıvata M8')

    await user.selectOptions(screen.getByLabelText('Depo'), WH_SHOP)
    await waitFor(() =>
      expect(lastList(db)?.url.searchParams.get('filter[warehouse_id]')).toBe(WH_SHOP),
    )
    await waitFor(() => expect(within(grid).queryByText('Cıvata M8')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Tüm filtreleri temizle' }))
    await user.click(screen.getByLabelText('Yeniden sipariş noktasının altındakiler'))
    await waitFor(() =>
      expect(lastList(db)?.url.searchParams.get('filter[below_reorder]')).toBe('true'),
    )

    await user.click(screen.getByLabelText('Yeniden sipariş noktasının altındakiler'))
    await user.selectOptions(screen.getByLabelText('Ayrıntı'), 'lot')
    await waitFor(() => expect(lastList(db)?.url.searchParams.get('group_by')).toBe('lot'))
    expect(await within(grid).findByText('L-2401')).toBeInTheDocument()
    expect(within(grid).getByText('Süresi doldu')).toBeInTheDocument()
    expect(within(grid).getByText('10 gün kaldı')).toBeInTheDocument()
  })

  it('saves and applies a view with filters and grouping', async () => {
    const db = setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock(`/inventory/stock?filter[warehouse_id]=${WH_SHOP}&filter[group]=location`)
    await screen.findByRole('grid', { name: 'Stok durumu' })
    await user.click(screen.getByRole('button', { name: 'Kayıtlı görünümler' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Geçerli görünümü kaydet…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Geçerli görünümü kaydet…' })
    await user.type(within(dialog).getByLabelText(/^Ad/), 'Mağaza lokasyon')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    const stored = JSON.parse(
      window.localStorage.getItem('keystone.inventory.views.stock-status') ?? '[]',
    ) as unknown[]
    expect(stored[0]).toEqual({
      name: 'Mağaza lokasyon',
      values: { warehouse_id: WH_SHOP, group: 'location' },
    })

    await user.click(screen.getByRole('button', { name: 'Tüm filtreleri temizle' }))
    await user.selectOptions(screen.getByLabelText('Ayrıntı'), 'item_warehouse')
    await waitFor(() =>
      expect(lastList(db)?.url.searchParams.get('group_by')).toBe('item_warehouse'),
    )
    await user.click(screen.getByRole('button', { name: 'Kayıtlı görünümler' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Mağaza lokasyon' }))
    // The same parameters were loaded at first, so the cached result may be served again.
    await waitFor(() => expect(screen.getByLabelText('Ayrıntı')).toHaveValue('location'))
    expect(screen.getByLabelText('Depo')).toHaveValue(WH_SHOP)
    expect(screen.getByRole('columnheader', { name: /^Lokasyon/ })).toBeInTheDocument()
  })

  it('exports the filtered list through the download client', async () => {
    const db = setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock(`/inventory/stock?filter[warehouse_id]=${WH_SHOP}`)
    await screen.findByRole('grid', { name: 'Stok durumu' })
    await user.click(screen.getByRole('button', { name: 'Excel' }))
    await waitFor(() =>
      expect(db.calls.some((c) => c.path === '/stock-balances/export')).toBe(true),
    )
    const call = db.calls.find((c) => c.path === '/stock-balances/export')
    expect(call?.url.searchParams.get('format')).toBe('xlsx')
    expect(call?.url.searchParams.get('filter[warehouse_id]')).toBe(WH_SHOP)
    expect(call?.url.searchParams.get('group_by')).toBe('item_warehouse')
    expect(call?.url.searchParams.has('page')).toBe(false)
  })

  it('opens the item stock drawer with warehouses, lots and recent movements', async () => {
    setupInventoryStock()
    const user = userEvent.setup()
    const { router } = renderInventoryStock('/inventory/stock')
    const grid = await screen.findByRole('grid', { name: 'Stok durumu' })
    await user.click(
      await within(grid).findByRole('button', { name: 'STK000001 stok ayrıntısını aç' }),
    )
    const drawer = await screen.findByRole('dialog', { name: 'STK000001 · Cıvata M8' })
    expect(router.state.location.search).toContain(`item=${ITEM_BOLT}`)
    expect(await within(drawer).findByText('1.256,5 ADET')).toBeInTheDocument()
    const lots = within(drawer).getByRole('table', { name: 'Partiler' })
    expect(within(lots).getByRole('link', { name: 'L-2401' })).toHaveAttribute(
      'href',
      '/inventory/lots/lot-old',
    )
    expect(within(lots).getByText('Süresi doldu')).toBeInTheDocument()
    expect(await within(drawer).findByText('−4')).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: /Tüm hareketleri göster/ })).toHaveAttribute(
      'href',
      `/inventory/movements?filter[item_id]=${ITEM_BOLT}`,
    )
    await user.keyboard('{Escape}')
    await waitFor(() => expect(router.state.location.search).not.toContain('item='))
  })

  it('hides the item picker without catalog access and needs stock view', async () => {
    setupInventoryStock({ permissions: ['inventory.stock.view'] })
    renderInventoryStock('/inventory/stock')
    await screen.findByRole('grid', { name: 'Stok durumu' })
    expect(screen.queryByLabelText('Ürün')).not.toBeInTheDocument()
    // Only the stock screens are offered in the section links.
    const nav = screen.getByRole('navigation', { name: 'Stok' })
    expect(within(nav).queryByRole('link', { name: 'Depolar' })).not.toBeInTheDocument()
  })

  it('is forbidden without stock view', async () => {
    setupInventoryStock({ permissions: ['inventory.warehouses.view'] })
    renderInventoryStock('/inventory/stock')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()
  })
})
