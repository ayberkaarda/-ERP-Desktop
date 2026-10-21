import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WH_MAIN, WH_SHOP } from '@/test/handlers/inventoryStock'
import { renderInventoryStock, setupInventoryStock } from '../../stock/testing'
import './WarehousesPage'

vi.setConfig({ testTimeout: 20_000 })

describe('warehouses page', () => {
  it('lists warehouses with their stock rules', async () => {
    setupInventoryStock()
    renderInventoryStock('/inventory/warehouses')
    const grid = await screen.findByRole('grid', { name: 'Depolar' })
    expect(await within(grid).findByText('Merkez depo')).toBeInTheDocument()
    const main = within(grid).getByText('Merkez depo').closest('tr') as HTMLElement
    expect(within(main).getByText('Varsayılan')).toBeInTheDocument()
    const shop = within(grid).getByText('Mağaza').closest('tr') as HTMLElement
    expect(within(shop).getByText('Evet')).toBeInTheDocument()
    expect(within(shop).getByText('Katı')).toBeInTheDocument()
    expect(within(grid).getByText('Pasif')).toBeInTheDocument()
    // The default warehouse and one with movements cannot be deleted.
    expect(within(main).getByRole('button', { name: 'MRK deposunu sil' })).toBeDisabled()
  })

  it('creates a warehouse with an idempotency key and continues on its locations', async () => {
    const db = setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock('/inventory/warehouses')
    await user.click(await screen.findByRole('button', { name: 'Yeni depo' }))
    const dialog = await screen.findByRole('dialog', { name: 'Yeni depo' })
    expect(within(dialog).getByRole('tab', { name: 'Lokasyonlar' })).toBeDisabled()

    await user.type(within(dialog).getByLabelText(/^Kod/), 'MRK')
    await user.type(within(dialog).getByLabelText(/^Ad(?!res)/), 'Yedek depo')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    // Duplicate code: the server error lands on the field.
    expect(await within(dialog).findAllByText('Bu kod zaten kullanılıyor.')).not.toHaveLength(0)

    const code = within(dialog).getByLabelText(/^Kod/)
    await user.clear(code)
    await user.type(code, 'YDK')
    await user.selectOptions(within(dialog).getByLabelText(/^Rezervasyon politikası/), 'hard')
    expect(
      within(dialog).getByText('Kullanılabilir miktarı aşan rezervasyon reddedilir.'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByLabelText('Eksi stok'))
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))

    expect(
      await within(dialog).findByRole('tab', { name: 'Lokasyonlar', selected: true }),
    ).toBeInTheDocument()
    const posts = db.calls.filter((c) => c.method === 'POST' && c.path === '/warehouses')
    expect(posts).toHaveLength(2)
    expect(posts[1]?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(posts[1]?.headers.get('Idempotency-Key')).not.toBe(
      posts[0]?.headers.get('Idempotency-Key'),
    )
    expect(posts[1]?.body).toEqual({
      code: 'YDK',
      name: 'Yedek depo',
      address: null,
      is_active: true,
      is_default: false,
      allow_negative_stock: true,
      reservation_policy: 'hard',
    })
    expect(db.warehouses.find((w) => w.code === 'YDK')).toBeDefined()
    expect(await within(dialog).findByText('Henüz lokasyon yok')).toBeInTheDocument()
  })

  it('offers a reload when someone else saved the warehouse first', async () => {
    const db = setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock('/inventory/warehouses')
    await user.click(await screen.findByRole('button', { name: 'MGZ deposunu düzenle' }))
    const dialog = await screen.findByRole('dialog', { name: 'MGZ deposunu düzenle' })
    const shop = db.warehouses.find((w) => w.id === WH_SHOP)
    if (shop) {
      shop.version = 5
      shop.name = 'Mağaza (yeni)'
    }
    const name = within(dialog).getByLabelText(/^Ad(?!res)/)
    await user.clear(name)
    await user.type(name, 'Mağaza 2')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect(
      await within(dialog).findByText('Kayıt başka biri tarafından değiştirildi'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Kaydet' })).toBeDisabled()

    await user.click(within(dialog).getByRole('button', { name: 'Yeniden yükle' }))
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/^Ad(?!res)/)).toHaveValue('Mağaza (yeni)'),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const patch = db.calls.filter((c) => c.method === 'PATCH').at(-1)
    expect(patch?.body).toMatchObject({ version: 5, name: 'Mağaza (yeni)' })
  })

  it('locks the default flag on the default warehouse and explains moving it', async () => {
    setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock('/inventory/warehouses')
    await user.click(await screen.findByRole('button', { name: 'MRK deposunu düzenle' }))
    let dialog = await screen.findByRole('dialog', { name: 'MRK deposunu düzenle' })
    expect(within(dialog).getByLabelText('Varsayılan depo')).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Vazgeç' }))

    await user.click(await screen.findByRole('button', { name: 'MGZ deposunu düzenle' }))
    dialog = await screen.findByRole('dialog', { name: 'MGZ deposunu düzenle' })
    await user.click(within(dialog).getByLabelText('Varsayılan depo'))
    expect(
      within(dialog).getByText('Kaydedince MRK varsayılan olmaktan çıkar.'),
    ).toBeInTheDocument()
  })

  it('shows warehouses read-only to a viewer', async () => {
    setupInventoryStock({ permissions: ['inventory.warehouses.view'] })
    const user = userEvent.setup()
    renderInventoryStock('/inventory/warehouses')
    const grid = await screen.findByRole('grid', { name: 'Depolar' })
    await within(grid).findByText('Merkez depo')
    expect(screen.queryByRole('button', { name: 'Yeni depo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'MRK deposunu düzenle' })).not.toBeInTheDocument()

    await user.click(within(grid).getByText('Merkez depo'))
    const dialog = await screen.findByRole('dialog', { name: 'MRK deposu' })
    expect(within(dialog).getByLabelText(/^Ad(?!res)/)).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Kaydet' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('tab', { name: 'Lokasyonlar' }))
    expect(await within(dialog).findByRole('tree')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Lokasyon ekle' })).not.toBeInTheDocument()
  })

  it('is forbidden without warehouse permissions', async () => {
    setupInventoryStock({ permissions: ['inventory.stock.view'] })
    renderInventoryStock('/inventory/warehouses')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })
})

describe('locations tree', () => {
  it('nests bins, navigates with the keyboard and adds a child bin', async () => {
    const db = setupInventoryStock()
    const user = userEvent.setup()
    renderInventoryStock('/inventory/warehouses')
    await user.click(await screen.findByRole('button', { name: 'MRK lokasyonlarını aç' }))
    const dialog = await screen.findByRole('dialog', { name: 'MRK deposunu düzenle' })
    const tree = await within(dialog).findByRole('tree', { name: 'MRK lokasyonları' })
    const a = within(tree).getByRole('treeitem', { name: /^A Koridor A/ })
    expect(a).toHaveAttribute('aria-level', '1')
    expect(a).toHaveAttribute('aria-expanded', 'true')
    const a0103 = within(tree).getByRole('treeitem', { name: /^A-01-03/ })
    expect(a0103).toHaveAttribute('aria-level', '3')

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

    await user.click(within(tree).getByRole('button', { name: 'A-01 altına lokasyon ekle' }))
    const form = within(dialog).getByRole('form', { name: 'Yeni lokasyon' })
    const code = within(form).getByLabelText(/^Kod/)
    expect(code).toHaveValue('A-01-')
    await user.type(code, '04')
    await user.type(within(form).getByLabelText(/^Ad(?!res)/), 'Göz 4')
    await user.click(within(form).getByRole('button', { name: 'Kaydet' }))
    expect(await within(tree).findByRole('treeitem', { name: /^A-01-04/ })).toHaveAttribute(
      'aria-level',
      '3',
    )
    const post = db.calls.find(
      (c) => c.method === 'POST' && c.path === `/warehouses/${WH_MAIN}/locations`,
    )
    expect(post?.body).toEqual({ code: 'A-01-04', name: 'Göz 4', is_active: true })
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
  })
})
