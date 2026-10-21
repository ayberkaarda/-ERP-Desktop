import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useRefT } from '../i18n'
import type { TreeRow } from '../types'
import type { TreeNode } from '../utils'

interface TreeViewProps<T extends TreeRow> {
  nodes: readonly TreeNode<T>[]
  label: string
  renderRow: (row: T) => ReactNode
}

/** Nested WAI-ARIA tree; rows with children can be collapsed. */
export function TreeView<T extends TreeRow>({ nodes, label, renderRow }: TreeViewProps<T>) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const t = useRefT()

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const renderLevel = (list: readonly TreeNode<T>[], level: number, root: boolean) => (
    <ul
      role={root ? 'tree' : 'group'}
      aria-label={root ? label : undefined}
      className={
        root ? 'divide-y divide-border rounded-md border border-border' : 'divide-y divide-border'
      }
    >
      {list.map((node) => {
        const hasChildren = node.children.length > 0
        const open = !collapsed.has(node.row.id)
        return (
          <li
            key={node.row.id}
            role="treeitem"
            aria-level={level}
            aria-expanded={hasChildren ? open : undefined}
            aria-selected={false}
            className="bg-surface"
          >
            <div
              className="flex min-h-10 items-center gap-1 pr-2"
              style={{ paddingLeft: `${(level - 1) * 1.5 + 0.5}rem` }}
            >
              {hasChildren ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t(open ? 'tree.collapse' : 'tree.expand', { name: node.row.name })}
                  onClick={() => toggle(node.row.id)}
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
