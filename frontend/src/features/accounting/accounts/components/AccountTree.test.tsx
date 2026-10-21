import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
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

  it('returns focus to the tree after a mouse click on a row button and handles bubbled keys', async () => {
    const accounts = [
      account({ id: 'p', code: '100', name: 'Kasa', is_postable: false }),
      account({ id: 'c1', code: '100.01', name: 'TL', parent_id: 'p' }),
      account({ id: 'c2', code: '100.02', name: 'USD', parent_id: 'p' }),
    ]
    function Harness() {
      const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
      const rows = visibleRows(buildTree(accounts), open, { q: '' })
      return (
        <AccountTree
          rows={rows}
          label="Hesaplar"
          selectedId={null}
          onSelect={vi.fn()}
          onToggle={(id, isOpen) => setOpen(isOpen ? new Set([id]) : new Set())}
        />
      )
    }
    const user = userEvent.setup()
    render(<Harness />)
    const tree = screen.getByRole('tree', { name: 'Hesaplar' })
    const expand = screen.getByRole('button', { name: '100 alt hesaplarını aç' })
    await user.click(expand)
    expect(tree).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    const active = () => document.getElementById(tree.getAttribute('aria-activedescendant') ?? '')
    expect(active()).toHaveAttribute('aria-label', expect.stringMatching(/^100.01/))
    // A key pressed while a row button still has focus bubbles to the tree.
    fireEvent.keyDown(screen.getByRole('button', { name: '100 alt hesaplarını kapat' }), {
      key: 'ArrowDown',
    })
    expect(active()).toHaveAttribute('aria-label', expect.stringMatching(/^100.02/))
  })
})
