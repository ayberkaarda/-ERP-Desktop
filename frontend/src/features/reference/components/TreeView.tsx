import { ChevronDown, ChevronRight } from 'lucide-react'
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useRefT } from '../i18n'
import type { TreeRow } from '../types'
import { flattenTree, type TreeNode } from '../utils'

interface TreeViewProps<T extends TreeRow> {
  nodes: readonly TreeNode<T>[]
  label: string
  renderRow: (row: T) => ReactNode
}

/**
 * WAI-ARIA tree: one tab stop (roving tabindex); Up/Down move, Right expands or enters the
 * first child, Left collapses or goes to the parent, Home/End jump, Enter/Space toggle a
 * branch. Controls inside a row keep their own tab order and key handling.
 */
export function TreeView<T extends TreeRow>({ nodes, label, renderRow }: TreeViewProps<T>) {
  const t = useRefT()
  const treeId = useId()
  const rootRef = useRef<HTMLUListElement>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)

  const visible = useMemo(() => flattenTree(nodes, collapsed), [nodes, collapsed])
  const parentOf = useMemo(() => {
    const map = new Map<string, string | null>()
    const walk = (list: readonly TreeNode<T>[], parent: string | null) => {
      for (const n of list) {
        map.set(n.row.id, parent)
        walk(n.children, n.row.id)
      }
    }
    walk(nodes, null)
    return map
  }, [nodes])

  // The roving stop falls back to the first visible row when the remembered one is gone.
  const tabStop = visible.some((n) => n.row.id === focusId) ? focusId : (visible[0]?.row.id ?? null)

  const itemId = (id: string) => `${treeId}-${id}`
  const moveTo = (id: string | undefined) => {
    if (!id) return
    setFocusId(id)
    const items = rootRef.current?.querySelectorAll<HTMLElement>('[data-item]') ?? []
    Array.from(items)
      .find((el) => el.dataset.item === itemId(id))
      ?.focus()
  }

  const setOpen = (id: string, open: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (open) next.delete(id)
      else next.add(id)
      return next
    })

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, node: TreeNode<T>) => {
    // Keys typed in a button or field inside the row are theirs.
    if (e.target !== e.currentTarget) return
    const index = visible.findIndex((n) => n.row.id === node.row.id)
    const open = !collapsed.has(node.row.id)
    const hasChildren = node.children.length > 0
    switch (e.key) {
      case 'ArrowDown':
        moveTo(visible[index + 1]?.row.id)
        break
      case 'ArrowUp':
        moveTo(visible[index - 1]?.row.id)
        break
      case 'Home':
        moveTo(visible[0]?.row.id)
        break
      case 'End':
        moveTo(visible.at(-1)?.row.id)
        break
      case 'ArrowRight':
        if (hasChildren && !open) setOpen(node.row.id, true)
        else if (hasChildren) moveTo(node.children[0]?.row.id)
        break
      case 'ArrowLeft':
        if (hasChildren && open) setOpen(node.row.id, false)
        else moveTo(parentOf.get(node.row.id) ?? undefined)
        break
      case 'Enter':
      case ' ':
        if (hasChildren) setOpen(node.row.id, !open)
        break
      default:
        return
    }
    e.preventDefault()
  }

  const renderLevel = (list: readonly TreeNode<T>[], level: number, root: boolean) => (
    <ul
      ref={root ? rootRef : undefined}
      role={root ? 'tree' : 'group'}
      aria-label={root ? label : undefined}
      className={
        root ? 'divide-y divide-border rounded-md border border-border' : 'divide-y divide-border'
      }
    >
      {list.map((node) => {
        const id = node.row.id
        const hasChildren = node.children.length > 0
        const open = !collapsed.has(id)
        return (
          <li key={id} role="none" className="bg-surface">
            <div
              role="treeitem"
              data-item={itemId(id)}
              aria-level={level}
              aria-expanded={hasChildren ? open : undefined}
              aria-selected={false}
              tabIndex={tabStop === id ? 0 : -1}
              onFocus={(e) => e.target === e.currentTarget && setFocusId(id)}
              onKeyDown={(e) => onKeyDown(e, node)}
              className="flex min-h-10 items-center gap-1 pr-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              style={{ paddingLeft: `${(level - 1) * 1.5 + 0.5}rem` }}
            >
              {hasChildren ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  tabIndex={-1}
                  aria-label={t(open ? 'tree.collapse' : 'tree.expand', { name: node.row.name })}
                  onClick={() => setOpen(id, !open)}
                >
                  {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                </Button>
              ) : (
                <span className="size-control-sm shrink-0" aria-hidden="true" />
              )}
              <div className="flex min-w-0 flex-1 items-center gap-2">{renderRow(node.row)}</div>
            </div>
            {hasChildren && open && renderLevel(node.children, level + 1, false)}
          </li>
        )
      })}
    </ul>
  )

  return renderLevel(nodes, 1, true)
}
