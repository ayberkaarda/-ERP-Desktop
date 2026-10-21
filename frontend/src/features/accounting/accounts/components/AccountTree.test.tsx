import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { account } from '@/test/handlers/accounting1'
import { buildTree, visibleRows } from '../lib/tree'
import { AccountTree } from './AccountTree'

describe('AccountTree', () => {
  // jsdom has no layout: give scroll containers a viewport so the virtualizer renders a window.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  })
  afterEach(() => vi.restoreAllMocks())

  it('virtualizes thousands of accounts and keeps the active row mounted', async () => {
    const accounts = Array.from({ length: 3000 }, (_, i) =>
      account({ id: `a${i}`, code: String(100000 + i), name: `Hesap ${i}` }),
    )
    const rows = visibleRows(buildTree(accounts), new Set(), { q: '' })
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <AccountTree
        rows={rows}
        label="Hesaplar"
        selectedId={null}
        onSelect={onSelect}
        onToggle={vi.fn()}
      />,
    )
    const tree = screen.getByRole('tree', { name: 'Hesaplar' })
    const rendered = within(tree).getAllByRole('treeitem').length
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(100)

    tree.focus()
    await user.keyboard('{End}')
    const active = tree.getAttribute('aria-activedescendant') ?? ''
    expect(document.getElementById(active)).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/^102999/),
    )
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ code: '102999' }))
  })
})
