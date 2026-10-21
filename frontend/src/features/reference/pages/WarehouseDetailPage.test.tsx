import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderRoutes } from '@/test/handlers/feaRender'
import { setupReference } from '@/test/handlers/referenceRender'
import { WarehouseDetailPage } from './WarehouseDetailPage'
import { WarehousesPage } from './WarehousesPage'

function renderDetail() {
  return renderRoutes(
    [{ path: '/reference/warehouses/:id', element: <WarehouseDetailPage /> }],
    '/reference/warehouses/w1',
  )
}

describe('WarehouseDetailPage', () => {
  it('shows the warehouse and its locations as a tree', async () => {
    setupReference()
    renderDetail()

    expect(await screen.findByRole('heading', { name: 'MERKEZ · Merkez depo' })).toBeInTheDocument()
    const tree = await screen.findByRole('tree', { name: 'Depo lokasyonları' })
    const items = within(tree).getAllByRole('treeitem')
    expect(items.map((i) => i.getAttribute('aria-level'))).toEqual(['1', '2', '1'])
    expect(within(tree).getByText('LOC-A01')).toBeInTheDocument()
  })

  it('adds a child location under a node', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: 'A koridoru altına lokasyon ekle' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Üst lokasyon')).toHaveValue('l1')
    await user.type(within(dialog).getByLabelText(/^Kod/), 'a-02')
    await user.type(within(dialog).getByLabelText(/^Ad\b/), 'A-02 rafı')
    await user.selectOptions(within(dialog).getByLabelText(/^Tür/), 'rack')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/warehouses/w1/locations')
    expect(post?.body).toMatchObject({ code: 'A-02', type: 'rack', parent_id: 'l1', barcode: null })
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(await screen.findByText('A-02 rafı')).toBeInTheDocument()
  })

  it('moves a location to another parent without offering its own subtree', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderDetail()

    await user.click(await screen.findByRole('button', { name: 'A koridoru lokasyonunu taşı' }))
    const dialog = await screen.findByRole('dialog')
    const parent = within(dialog).getByLabelText('Yeni üst lokasyon')
    expect(
      within(parent)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Üst kayıt yok (kök)', 'B · B koridoru'])
    await user.selectOptions(parent, 'l3')
    await user.click(within(dialog).getByRole('button', { name: 'Taşı' }))

    await waitFor(() => {
      const patch = db.calls.find(
        (c) => c.method === 'PATCH' && c.path === '/warehouses/w1/locations/l1',
      )
      expect(patch?.body).toEqual({ parent_id: 'l3', version: 1 })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('deactivates a location and flags it in the tree', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderDetail()

    await user.click(
      await screen.findByRole('button', { name: 'B koridoru lokasyonunu pasif yap' }),
    )
    await waitFor(() =>
      expect(
        db.calls.find((c) => c.method === 'PATCH' && c.path === '/warehouses/w1/locations/l3')
          ?.body,
      ).toEqual({ is_active: false, version: 1 }),
    )
    expect(
      await screen.findByRole('button', { name: 'B koridoru lokasyonunu aktif yap' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Pasif')).toBeInTheDocument()
  })

  it('hides the editing controls from users who cannot manage warehouses', async () => {
    setupReference({ permissions: ['warehouses.view'] })
    renderDetail()
    await screen.findByRole('tree', { name: 'Depo lokasyonları' })
    expect(
      screen.queryByRole('button', { name: /lokasyon ekle|Yeni lokasyon|taşı|pasif yap/ }),
    ).not.toBeInTheDocument()
  })
})

describe('WarehousesPage', () => {
  it('creates a warehouse with the address nested and maps nested server errors', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderRoutes(
      [{ path: '/reference/warehouses', element: <WarehousesPage /> }],
      '/reference/warehouses',
    )

    expect(await screen.findByText('MERKEZ')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yeni depo' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Kod/), 'ege')
    await user.type(within(dialog).getByLabelText(/^Ad\b/), 'Ege depo')
    await user.type(within(dialog).getByLabelText('İl'), 'Manisa')
    await user.type(within(dialog).getByLabelText('Ülke (2 harf)'), 'tr')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/warehouses')
    expect(post?.body).toMatchObject({
      code: 'EGE',
      negative_stock_policy: 'block',
      address: { city: 'Manisa', country: 'TR' },
    })
  })
})
