import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderCatalog, setupCatalog } from '../testing'
import './CategoriesPage'

function drag(source: HTMLElement, target: HTMLElement) {
  const dataTransfer = { setData: () => undefined, effectAllowed: '', dropEffect: '' }
  const fire = (el: HTMLElement, type: 'dragStart' | 'dragOver' | 'drop') => {
    const event = createEvent[type](el)
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
    fireEvent(el, event)
  }
  fire(source, 'dragStart')
  fire(target, 'dragOver')
  fire(target, 'drop')
}

describe('CategoriesPage', () => {
  it('expands and collapses with the keyboard', async () => {
    setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/categories')

    const root = await screen.findByRole('treeitem', { name: 'HM Hammadde' })
    expect(root).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: 'HM.01 Metal' })).not.toBeInTheDocument()

    root.focus()
    await user.keyboard('{ArrowRight}')
    expect(root).toHaveAttribute('aria-expanded', 'true')
    const metal = await screen.findByRole('treeitem', { name: 'HM.01 Metal' })
    expect(metal).toHaveAttribute('aria-level', '2')

    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(metal).toHaveFocus())
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(root).toHaveFocus())
    await user.keyboard('{ArrowLeft}')
    expect(root).toHaveAttribute('aria-expanded', 'false')

    await user.click(screen.getByRole('button', { name: 'Tümünü aç' }))
    expect(screen.getByRole('treeitem', { name: 'HM.01.01 Bağlantı' })).toBeInTheDocument()
  })

  it('blocks moves that would create a cycle and saves valid ones', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/categories')
    await user.click(await screen.findByRole('button', { name: 'Tümünü aç' }))

    const root = screen.getByRole('treeitem', { name: 'HM Hammadde' })
    const fastener = screen.getByRole('treeitem', { name: 'HM.01.01 Bağlantı' })
    drag(root, fastener)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bağlantı, Hammadde kategorisinin alt kategorisi. Bu taşıma döngü oluşturur.',
    )
    expect(db.calls.some((c) => c.method === 'PATCH')).toBe(false)

    drag(fastener, screen.getByRole('treeitem', { name: 'HZ Hizmet' }))
    expect(await screen.findByText('Bağlantı taşındı.')).toBeInTheDocument()
    const patch = db.calls.find((c) => c.method === 'PATCH')
    expect(patch?.path).toBe('/item-categories/cat-fastener')
    expect(patch?.body).toEqual({ parent_id: 'cat-service', version: 1 })
  })

  it('move dialog disables the category itself and its descendants', async () => {
    setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/categories')
    await user.click(await screen.findByRole('button', { name: 'Hammadde kategorisini taşı' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('combobox'))
    await user.keyboard('{ArrowDown}')
    const metal = await screen.findByRole('option', { name: /Metal/ })
    expect(metal).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: /Hizmet/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('exposes position in set and keyboard row actions', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/categories')
    const root = await screen.findByRole('treeitem', { name: 'HM Hammadde' })
    expect(root).toHaveAttribute('aria-posinset', '1')
    expect(root).toHaveAttribute('aria-setsize', '2')
    const service = screen.getByRole('treeitem', { name: 'HZ Hizmet' })
    expect(service).toHaveAttribute('aria-posinset', '2')

    service.focus()
    await user.keyboard('{Delete}')
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('Hizmet silinecek.')
    await user.click(within(confirm).getByRole('button', { name: 'Sil' }))
    await waitFor(() => expect(db.categories.some((c) => c.id === 'cat-service')).toBe(false))

    const rootAgain = screen.getByRole('treeitem', { name: 'HM Hammadde' })
    rootAgain.focus()
    await user.keyboard('{Insert}')
    expect(await screen.findByRole('dialog', { name: 'Yeni kategori' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    screen.getByRole('treeitem', { name: 'HM Hammadde' }).focus()
    await user.keyboard('m')
    expect(
      await screen.findByRole('dialog', { name: 'Hammadde kategorisini taşı' }),
    ).toBeInTheDocument()
  })

  it('adds a child category under the chosen parent', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/categories')
    await user.click(await screen.findByRole('button', { name: 'Hizmet altına kategori ekle' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Kod/), 'HZ.01')
    await user.type(within(dialog).getByLabelText(/^Ad/), 'Montaj')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(db.categories.some((c) => c.code === 'HZ.01')).toBe(true))
    expect(db.categories.find((c) => c.code === 'HZ.01')?.parent_id).toBe('cat-service')
    expect(await screen.findByRole('treeitem', { name: 'HZ.01 Montaj' })).toBeInTheDocument()
  })
})
