import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderCatalog, setupCatalog } from '../testing'
// Loaded up front so the lazy routes resolve without a chunk delay.
import './CategoriesPage'
import './DiscountRulesPage'
import './UnitsPage'

describe('catalog setup pages for readers', () => {
  it('lets an item viewer read units and conversions without any write action', async () => {
    setupCatalog({ permissions: ['items.view'] })
    const user = userEvent.setup()
    renderCatalog('/catalog/units')

    expect(await screen.findByText('Kilogram')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yeni birim' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'KG birimini düzenle' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Dönüşüm tablosu' }))
    const cells = await screen.findAllByRole('textbox', { name: /^1 \S+ kaç / })
    expect(cells.length).toBeGreaterThan(0)
    cells.forEach((cell) => expect(cell).toBeDisabled())
    expect(screen.queryByRole('button', { name: 'Dönüşümleri kaydet' })).not.toBeInTheDocument()
  })

  it('keeps the unit write actions for units.manage', async () => {
    setupCatalog({ permissions: ['units.manage'] })
    renderCatalog('/catalog/units')

    expect(await screen.findByRole('button', { name: 'Yeni birim' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'KG birimini düzenle' })).toBeInTheDocument()
  })

  it('shows the category tree read-only to an item viewer, keyboard shortcuts included', async () => {
    setupCatalog({ permissions: ['items.view'] })
    const user = userEvent.setup()
    renderCatalog('/catalog/categories')

    const root = await screen.findByRole('treeitem', { name: 'HM Hammadde' })
    expect(root).toHaveAttribute('draggable', 'false')
    expect(screen.queryByRole('button', { name: 'Yeni kategori' })).not.toBeInTheDocument()
    expect(within(root).queryAllByRole('button', { hidden: true })).toHaveLength(1) // expand toggle only

    root.focus()
    for (const key of ['{Enter}', '{Insert}', 'm', '{Delete}']) {
      await user.keyboard(key)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    }
  })

  it('keeps the category write actions for item_categories.manage', async () => {
    setupCatalog({ permissions: ['item_categories.manage'] })
    renderCatalog('/catalog/categories')

    const root = await screen.findByRole('treeitem', { name: 'HM Hammadde' })
    expect(root).toHaveAttribute('draggable', 'true')
    expect(screen.getByRole('button', { name: 'Yeni kategori' })).toBeInTheDocument()
    expect(
      within(root).getByRole('button', { name: 'Hammadde kategorisini düzenle', hidden: true }),
    ).toBeInTheDocument()
  })

  it('lets a pricing viewer read discount rules without new, edit or delete', async () => {
    setupCatalog({ permissions: ['pricing.view'] })
    renderCatalog('/catalog/discount-rules')

    expect(await screen.findByText('IND10')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yeni kural' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'IND10 kuralını düzenle' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'IND10 kuralını sil' })).not.toBeInTheDocument()
  })

  it('keeps the discount rule write actions for discount_rules.manage', async () => {
    setupCatalog({ permissions: ['discount_rules.manage'] })
    renderCatalog('/catalog/discount-rules')

    expect(await screen.findByRole('button', { name: 'Yeni kural' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'IND10 kuralını sil' })).toBeInTheDocument()
  })

  it.each(['/catalog/units', '/catalog/categories', '/catalog/discount-rules'])(
    'forbids %s without the read or the manage permission',
    async (path) => {
      setupCatalog({ permissions: ['price_lists.view'] })
      renderCatalog(path)

      expect(
        await screen.findByRole('heading', { name: 'Bu sayfaya erişiminiz yok' }),
      ).toBeInTheDocument()
    },
  )
})
