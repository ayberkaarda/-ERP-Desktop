import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WH_MAIN, WH_SHOP } from '@/test/handlers/inventoryStock'
import { renderInventoryStock, setupInventoryStock } from '../../stock/testing'
import './WarehousesPage'

vi.setConfig({ testTimeout: 20_000 })

const VIEWER = ['inventory.warehouses.view', 'warehouses.view']

describe('warehouses page', () => {
  it('lists /stock-warehouses with Reference rules and the reservation policy', async () => {
    const db = setupInventoryStock()
    renderInventoryStock('/inventory/warehouses')
    const grid = await screen.findByRole('grid', { name: 'Depolar' })
    const main = (await within(grid).findByText('Merkez depo')).closest('tr') as HTMLElement
    expect(within(main).getByText('Varsayılan')).toBeInTheDocument()
    expect(within(main).getByText('Engellenir')).toBeInTheDocument()
    expect(within(main).getByText('Esnek')).toBeInTheDocument()
    const shop = within(grid).getByText('Mağaza').closest('tr') as HTMLElement
    expect(within(shop).getByText('İzin verilir')).toBeInTheDocument()
    expect(within(shop).getByText('Katı')).toBeInTheDocument()
    expect(within(grid).getByText('Pasif')).toBeInTheDocument()
    // Master data is maintained in Reference: no create or delete here.
    expect(screen.queryByRole('button', { name: /Yeni depo/ })).not.toBeInTheDocument()
    expect(within(grid).queryByRole('button', { name: /sil$/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: "Referans'ta yönet" })).toHaveAttribute(
      'href',
      '/reference/warehouses',
    )
    const list = db.calls.filter((c) => c.path === '/stock-warehouses')
    expect(list).toHaveLength(1)
    expect([...(list[0]?.url.searchParams.keys() ?? [])]).toEqual([])
  })

  it('searches and filters the unpaginated list in the browser', async () => {
    const db = setupInventoryStock()
    renderInventoryStock('/inventory/warehouses?filter[reservation_policy]=hard')
    const grid = await screen.findByRole('grid', { name: 'Depolar' })
    expect(await within(grid).findByText('Mağaza')).toBeInTheDocument()
    expect(within(grid).queryByText('Merkez depo')).not.toBeInTheDocument()
    expect(db.calls.every((c) => !c.url.searchParams.has('filter[reservation_policy]'))).toBe(true)
  })

  it('changes the reservation policy with the settings version', async () => {
    const db = setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock('/inventory/warehouses')
    await user.click(
      await screen.findByRole('button', { name: 'MGZ rezervasyon politikasını değiştir' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'MGZ rezervasyon politikası' })
    expect(await within(dialog).findByText('Bu depoda stok hareketi var.')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('link', { name: "MGZ deposunu Referans'ta aç" }),
    ).toHaveAttribute('href', `/reference/warehouses/${WH_SHOP}`)
    await user.selectOptions(within(dialog).getByLabelText(/^Rezervasyon politikası/), 'none')
    expect(
      within(dialog).getByText(
        'Rezervasyon yapılmaz; kullanılabilir miktar eldeki miktara eşittir.',
      ),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const patch = db.calls.find((c) => c.method === 'PATCH')
    expect(patch?.path).toBe(`/stock-warehouses/${WH_SHOP}`)
    expect(patch?.body).toEqual({ reservation_policy: 'none', version: 1 })
    expect(db.warehouses.find((w) => w.id === WH_SHOP)?.reservation_policy).toBe('none')
  })

  it('offers a reload when someone else changed the policy first', async () => {
    const db = setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock('/inventory/warehouses')
    await user.click(
      await screen.findByRole('button', { name: 'MGZ rezervasyon politikasını değiştir' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'MGZ rezervasyon politikası' })
    const shop = db.warehouses.find((w) => w.id === WH_SHOP)
    if (shop) {
      shop.version = 5
      shop.reservation_policy = 'soft'
    }
    await user.selectOptions(within(dialog).getByLabelText(/^Rezervasyon politikası/), 'none')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect(
      await within(dialog).findByText('Kayıt başka biri tarafından değiştirildi'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Kaydet' })).toBeDisabled()

    await user.click(within(dialog).getByRole('button', { name: 'Yeniden yükle' }))
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/^Rezervasyon politikası/)).toHaveValue('soft'),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const patch = db.calls.filter((c) => c.method === 'PATCH').at(-1)
    expect(patch?.body).toEqual({ reservation_policy: 'soft', version: 5 })
  })

  it('shows warehouses read-only to a viewer, without the Reference links', async () => {
    const db = setupInventoryStock({ permissions: VIEWER })
    const user = userEvent.setup()
    renderInventoryStock('/inventory/warehouses')
    const grid = await screen.findByRole('grid', { name: 'Depolar' })
    await within(grid).findByText('Merkez depo')
    expect(screen.queryByRole('link', { name: "Referans'ta yönet" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'MRK rezervasyon politikasını değiştir' }),
    ).not.toBeInTheDocument()

    await user.click(within(grid).getByText('Merkez depo'))
    const dialog = await screen.findByRole('dialog', { name: 'MRK deposu' })
    expect(within(dialog).getByLabelText(/^Rezervasyon politikası/)).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Kaydet' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: /Referans'ta aç/ })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('tab', { name: 'Lokasyonlar' }))
    expect(await within(dialog).findByRole('tree')).toBeInTheDocument()
    expect(db.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('hides locations without Reference warehouse access', async () => {
    const db = setupInventoryStock({ permissions: ['inventory.warehouses.manage'] })
    const user = userEvent.setup()
    renderInventoryStock('/inventory/warehouses')
    const grid = await screen.findByRole('grid', { name: 'Depolar' })
    const edit = await within(grid).findByRole('button', {
      name: 'MRK rezervasyon politikasını değiştir',
    })
    expect(
      within(grid).queryByRole('button', { name: 'MRK lokasyonlarını aç' }),
    ).not.toBeInTheDocument()
    await user.click(edit)
    const dialog = await screen.findByRole('dialog', { name: 'MRK rezervasyon politikası' })
    expect(within(dialog).queryByRole('tab', { name: 'Lokasyonlar' })).not.toBeInTheDocument()
    expect(db.calls.some((c) => c.path.endsWith('/locations'))).toBe(false)
  })

  it('is forbidden without warehouse permissions', async () => {
    setupInventoryStock({ permissions: ['inventory.stock.view'] })
    renderInventoryStock('/inventory/warehouses')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })
})

describe('locations tree', () => {
  it('nests Reference locations by parent and navigates with the keyboard, read-only', async () => {
    const db = setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock('/inventory/warehouses')
    await user.click(await screen.findByRole('button', { name: 'MRK lokasyonlarını aç' }))
    const dialog = await screen.findByRole('dialog', { name: 'MRK rezervasyon politikası' })
    const tree = await within(dialog).findByRole('tree', { name: 'MRK lokasyonları' })
    const a = within(tree).getByRole('treeitem', { name: /^A Koridor A/ })
    expect(a).toHaveAttribute('aria-level', '1')
    expect(a).toHaveAttribute('aria-expanded', 'true')
    const a0103 = within(tree).getByRole('treeitem', { name: /^A-01-03/ })
    expect(a0103).toHaveAttribute('aria-level', '3')
    expect(within(a0103).getByText('Göz')).toBeInTheDocument()
    expect(within(a0103).getByText('8690000000013')).toBeInTheDocument()

    a.focus()
    await user.keyboard('{ArrowLeft}')
    expect(a).toHaveAttribute('aria-expanded', 'false')
    expect(within(tree).queryByRole('treeitem', { name: /^A-01-03/ })).not.toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(a).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(within(tree).getByRole('treeitem', { name: /^A-01 Raf/ })).toHaveFocus(),
    )
    expect(within(dialog).queryByRole('button', { name: /lokasyon ekle/i })).not.toBeInTheDocument()
    const read = db.calls.find((c) => c.path === `/warehouses/${WH_MAIN}/locations`)
    expect(read?.url.searchParams.get('per_page')).toBe('100')
    expect(db.calls.some((c) => c.method === 'POST')).toBe(false)
  })
})
