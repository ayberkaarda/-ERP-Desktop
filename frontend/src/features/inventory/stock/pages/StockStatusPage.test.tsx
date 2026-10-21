import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ITEM_BOLT } from '@/test/handlers/catalog'
import { WH_SHOP } from '@/test/handlers/inventoryStock'
import { COMPANY_A } from '@/test/handlers/fea'
import { useAuthStore } from '@/stores/auth'
import { viewStorageKey } from '../lib/savedViews'
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
    expect(within(bolt).getByText('MRK')).toBeInTheDocument()
    const glove = within(grid).getByText('İş eldiveni').closest('tr') as HTMLElement
    expect(within(glove).getAllByText('-2')[0]).toHaveClass('text-danger')
    // The zero glove balance in the main warehouse is left out unless asked for.
    expect(within(grid).getAllByText('İş eldiveni')).toHaveLength(1)
    expect(lastList(db)?.url.searchParams.get('group_by')).toBe('warehouse')
    expect(lastList(db)?.url.searchParams.get('sort')).toBe('item_code')
  })

  it('filters by warehouse and zero balances, groups by item or location and lot', async () => {
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
    await user.click(screen.getByLabelText('Sıfır bakiyeleri de göster'))
    await waitFor(() =>
      expect(lastList(db)?.url.searchParams.get('filter[include_zero]')).toBe('true'),
    )
    await waitFor(() => expect(within(grid).getAllByText('İş eldiveni')).toHaveLength(2))

    await user.click(screen.getByLabelText('Sıfır bakiyeleri de göster'))
    await user.selectOptions(screen.getByLabelText('Ayrıntı'), 'item')
    await waitFor(() => expect(lastList(db)?.url.searchParams.get('group_by')).toBe('item'))
    expect(screen.queryByRole('columnheader', { name: /^Depo/ })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Ayrıntı'), 'detail')
    await waitFor(() => expect(lastList(db)?.url.searchParams.get('group_by')).toBe('detail'))
    expect(await within(grid).findByText('L-2401')).toBeInTheDocument()
    expect(within(grid).getByText('A-01')).toBeInTheDocument()
    expect(within(grid).getByText('Süresi doldu')).toBeInTheDocument()
    expect(within(grid).getByText('10 gün kaldı')).toBeInTheDocument()
  })

  it('saves and applies a view with filters and grouping', async () => {
    const db = setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock(`/inventory/stock?filter[warehouse_id]=${WH_SHOP}&filter[group]=detail`)
    await screen.findByRole('grid', { name: 'Stok durumu' })
    await user.click(screen.getByRole('button', { name: 'Kayıtlı görünümler' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Geçerli görünümü kaydet…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Geçerli görünümü kaydet…' })
    await user.type(within(dialog).getByLabelText(/^Ad/), 'Mağaza lokasyon')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    const stored = JSON.parse(
      window.localStorage.getItem(
        viewStorageKey('stock-status', useAuthStore.getState().user?.id, COMPANY_A) ?? '',
      ) ?? '[]',
    ) as unknown[]
    expect(stored[0]).toEqual({
      name: 'Mağaza lokasyon',
      values: { warehouse_id: WH_SHOP, group: 'detail' },
    })

    await user.click(screen.getByRole('button', { name: 'Tüm filtreleri temizle' }))
    await waitFor(() => expect(lastList(db)?.url.searchParams.get('group_by')).toBe('warehouse'))
    await user.click(screen.getByRole('button', { name: 'Kayıtlı görünümler' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Mağaza lokasyon' }))
    // The same parameters were loaded at first, so the cached result may be served again.
    await waitFor(() => expect(screen.getByLabelText('Ayrıntı')).toHaveValue('detail'))
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
    expect(call?.url.searchParams.get('group_by')).toBe('warehouse')
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
    const byWarehouse = await within(drawer).findByRole('table', { name: 'Depolara göre' })
    expect(within(byWarehouse).getByText('MRK')).toBeInTheDocument()
    expect(within(byWarehouse).getByText('1.056,5')).toBeInTheDocument()
    const lots = within(drawer).getByRole('table', { name: 'Partiler' })
    expect(within(lots).getByRole('link', { name: 'L-2401' })).toHaveAttribute(
      'href',
      '/inventory/lots/lot-old',
    )
    expect(within(lots).getByText('Süresi doldu')).toBeInTheDocument()
    expect(within(lots).getByText('1.050,5')).toBeInTheDocument()
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

  it('requests only the filters the page can show and reset', async () => {
    const db = setupInventoryStock({ permissions: ['inventory.stock.view'] })
    const user = userEvent.setup()
    renderInventoryStock(
      `/inventory/stock?filter[location_id]=loc-a01&filter[bogus]=1&filter[item_id]=${ITEM_BOLT}&filter[include_zero]=yes&filter[group]=nope&filter[warehouse_id]=${WH_SHOP}`,
    )
    await screen.findByRole('grid', { name: 'Stok durumu' })
    const call = lastList(db)
    const filters = [...(call?.url.searchParams.keys() ?? [])].filter((k) =>
      k.startsWith('filter['),
    )
    expect(filters).toEqual(['filter[warehouse_id]'])
    expect(call?.url.searchParams.get('group_by')).toBe('warehouse')
    // The one accepted filter has a control and the reset clears it.
    expect(screen.getByLabelText('Depo')).toHaveValue(WH_SHOP)
    await user.click(screen.getByRole('button', { name: 'Tüm filtreleri temizle' }))
    await waitFor(() =>
      expect(lastList(db)?.url.searchParams.has('filter[warehouse_id]')).toBe(false),
    )
    expect(screen.queryByRole('button', { name: 'Tüm filtreleri temizle' })).not.toBeInTheDocument()
  })

  it('loads warehouse options from /stock-warehouses with stock view only', async () => {
    const db = setupInventoryStock({ permissions: ['inventory.stock.view'] })
    const user = userEvent.setup()
    renderInventoryStock('/inventory/stock')
    const grid = await screen.findByRole('grid', { name: 'Stok durumu' })
    await within(grid).findByText('Cıvata M8')
    const select = screen.getByLabelText('Depo')
    expect(await within(select).findByRole('option', { name: 'MGZ · Mağaza' })).toBeInTheDocument()
    expect(
      within(select).getByRole('option', { name: 'ESK · Eski depo (Pasif)' }),
    ).toBeInTheDocument()
    await user.selectOptions(select, WH_SHOP)
    await waitFor(() =>
      expect(lastList(db)?.url.searchParams.get('filter[warehouse_id]')).toBe(WH_SHOP),
    )
    expect(db.calls.some((c) => c.path === '/stock-warehouses')).toBe(true)
    expect(db.calls.some((c) => c.path === '/warehouses')).toBe(false)
  })
})
