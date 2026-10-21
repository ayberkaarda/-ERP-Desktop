import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderCatalog, setupCatalog } from '../testing'
import './ItemListPage'

describe('ItemListPage', () => {
  beforeEach(() => window.localStorage.clear())

  it('lists items with category and unit names', async () => {
    setupCatalog()
    renderCatalog('/catalog/items')
    const grid = await screen.findByRole('grid', { name: 'Stok kartları' })
    expect(await within(grid).findByText('Cıvata M8')).toBeInTheDocument()
    expect(within(grid).getByText('Montaj hizmeti')).toBeInTheDocument()
    expect(await within(grid).findByText('Bağlantı')).toBeInTheDocument()
    expect(within(grid).getAllByText('ADET').length).toBeGreaterThan(0)
    expect(within(grid).getByText('Lot takipli')).toBeInTheDocument()
  })

  it('sends URL filters to the API', async () => {
    const db = setupCatalog()
    renderCatalog('/catalog/items?filter[type]=service&filter[is_active]=true')
    const grid = await screen.findByRole('grid', { name: 'Stok kartları' })
    expect(await within(grid).findByText('Montaj hizmeti')).toBeInTheDocument()
    expect(within(grid).queryByText('Cıvata M8')).not.toBeInTheDocument()
    const call = db.calls.find((c) => c.method === 'GET' && c.path === '/items')
    expect(call?.url.searchParams.get('filter[type]')).toBe('service')
    expect(call?.url.searchParams.get('filter[is_active]')).toBe('true')
  })

  it('filters by category subtree with the API filter name', async () => {
    const db = setupCatalog()
    renderCatalog('/catalog/items?filter[category]=cat-root')
    const grid = await screen.findByRole('grid', { name: 'Stok kartları' })
    // cat-fastener sits below cat-root, so the bolt matches; the service item does not.
    expect(await within(grid).findByText('Cıvata M8')).toBeInTheDocument()
    expect(within(grid).queryByText('Montaj hizmeti')).not.toBeInTheDocument()
    const call = db.calls.find((c) => c.method === 'GET' && c.path === '/items')
    expect(call?.url.searchParams.get('filter[category]')).toBe('cat-root')
    expect(call?.url.searchParams.has('filter[category_id]')).toBe(false)
  })

  it('searches by barcode through q', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/items')
    await screen.findByText('Cıvata M8')
    await user.type(screen.getByRole('searchbox', { name: 'Listede ara' }), '4006381333931')
    expect(await screen.findByText('Barkodla aranıyor')).toBeInTheDocument()
    await waitFor(() =>
      expect(
        db.calls.some(
          (c) => c.path === '/items' && c.url.searchParams.get('q') === '4006381333931',
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(screen.queryByText('Montaj hizmeti')).not.toBeInTheDocument())
    expect(screen.getByText('Cıvata M8')).toBeInTheDocument()
  })

  it('saves and reapplies a named view', async () => {
    setupCatalog()
    const user = userEvent.setup()
    const { router } = renderCatalog('/catalog/items?filter[tracking]=lot')
    await screen.findByText('Cıvata M8')
    await user.click(screen.getByRole('button', { name: 'Kayıtlı görünümler' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Geçerli filtreleri kaydet…' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Görünüm adı/), 'Lotlu stoklar')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))

    await router.navigate('/catalog/items')
    await waitFor(() => expect(screen.getByText('Montaj hizmeti')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Kayıtlı görünümler' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Lotlu stoklar' }))
    await waitFor(() => expect(router.state.location.search).toContain('tracking'))
    await waitFor(() => expect(screen.queryByText('Montaj hizmeti')).not.toBeInTheDocument())
  })

  it('hides the create button without items.create', async () => {
    setupCatalog({ permissions: ['items.view'] })
    renderCatalog('/catalog/items')
    await screen.findByText('Cıvata M8')
    expect(screen.queryByRole('link', { name: 'Yeni stok kartı' })).not.toBeInTheDocument()
  })
})
