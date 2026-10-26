import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, MapPin } from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { EmptyState } from '@/components/shared/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useWarehouseLocations, type StockWarehouse } from '../../shared/warehouses'
import { LoadError } from '../../stock/components/common'
import { useInvT } from '../../stock/lib/i18n'
import { branchIds, buildLocationTree, visibleNodes, type LocationNode } from '../lib/locationTree'

/**
 * Locations of one warehouse as a read-only, keyboard-navigable tree built from Reference's
 * parent_id. Adding or changing locations happens on the Reference warehouse screen.
 */
export function LocationsPanel({ warehouse }: { warehouse: StockWarehouse }) {
  const t = useInvT()
  const locations = useWarehouseLocations(warehouse.id)
  const tree = useMemo(() => buildLocationTree(locations.data ?? []), [locations.data])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const treeRef = useRef<HTMLUListElement>(null)

  const branches = useMemo(() => branchIds(tree), [tree])
  const expanded = useMemo(
    () => new Set(branches.filter((id) => !collapsed.has(id))),
    [branches, collapsed],
  )
  const rows = visibleNodes(tree, expanded)
  const active = rows.find((r) => r.location.id === activeId) ?? rows[0]

  const toggle = (id: string, open?: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      const isOpen = !prev.has(id)
      if (open ?? !isOpen) next.delete(id)
      else next.add(id)
      return next
    })

  const focusRow = (id: string) => {
    setActiveId(id)
    requestAnimationFrame(() =>
      treeRef.current
        ?.querySelector<HTMLElement>(`[data-location-id="${CSS.escape(id)}"]`)
        ?.focus(),
    )
  }

  const parentOfNode = (node: LocationNode): LocationNode | undefined => {
    const index = rows.indexOf(node)
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = rows[i]
      if (candidate && candidate.depth < node.depth) return candidate
    }
    return undefined
  }

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, node: LocationNode) => {
    if (e.target !== e.currentTarget) return
    const index = rows.indexOf(node)
    const id = node.location.id
    const hasChildren = node.children.length > 0
    const go = (i: number) => {
      const target = rows[Math.min(Math.max(i, 0), rows.length - 1)]
      if (target) focusRow(target.location.id)
    }
    const handlers: Record<string, () => void> = {
      ArrowDown: () => go(index + 1),
      ArrowUp: () => go(index - 1),
      Home: () => go(0),
      End: () => go(rows.length - 1),
      ArrowRight: () => {
        if (hasChildren && !expanded.has(id)) toggle(id, true)
        else if (hasChildren) go(index + 1)
      },
      ArrowLeft: () => {
        if (hasChildren && expanded.has(id)) toggle(id, false)
        else {
          const parent = parentOfNode(node)
          if (parent) focusRow(parent.location.id)
        }
      },
    }
    const handler = handlers[e.key]
    if (handler) {
      e.preventDefault()
      handler()
    }
  }

  const total = locations.data?.length ?? 0

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {t('locations.count', { count: total })}
        </p>
        {branches.length > 0 && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set())}>
              <ChevronsUpDown aria-hidden="true" />
              {t('locations.expandAll')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set(branches))}>
              <ChevronsDownUp aria-hidden="true" />
              {t('locations.collapseAll')}
            </Button>
          </>
        )}
      </div>

      {locations.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : locations.isError ? (
        <LoadError error={locations.error} onRetry={() => void locations.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          icon={<MapPin className="size-8 text-muted-foreground" aria-hidden="true" />}
          title={t('locations.emptyTitle')}
          description={t('locations.emptyBody')}
        />
      ) : (
        <ul
          ref={treeRef}
          role="tree"
          aria-label={t('locations.treeLabel', { code: warehouse.code })}
          className="max-h-[50vh] overflow-y-auto rounded-md border border-border bg-surface py-1"
        >
          {rows.map((node) => {
            const l = node.location
            const hasChildren = node.children.length > 0
            const isOpen = expanded.has(l.id)
            const siblings = parentOfNode(node)?.children ?? tree
            return (
              <li
                key={l.id}
                role="treeitem"
                aria-label={`${l.code} ${l.name}${l.is_active ? '' : ` (${t('common.inactive')})`}`}
                data-location-id={l.id}
                aria-level={node.depth + 1}
                aria-setsize={siblings.length}
                aria-posinset={siblings.indexOf(node) + 1}
                aria-expanded={hasChildren ? isOpen : undefined}
                aria-selected={active?.location.id === l.id}
                tabIndex={active?.location.id === l.id ? 0 : -1}
                onFocus={(e) => {
                  if (e.target === e.currentTarget) setActiveId(l.id)
                }}
                onKeyDown={(e) => onKeyDown(e, node)}
                className={cn(
                  'flex h-9 items-center gap-2 pr-2 text-sm outline-none',
                  'hover:bg-surface-sunken focus-visible:bg-primary-soft/40 focus-visible:shadow-[inset_2px_0_0_var(--color-ring)]',
                )}
                style={{ paddingLeft: `${0.5 + node.depth * 1.25}rem` }}
              >
                <span className="inline-flex size-5 items-center justify-center">
                  {hasChildren && (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={
                        isOpen
                          ? t('locations.collapse', { code: l.code })
                          : t('locations.expand', { code: l.code })
                      }
                      className="rounded-sm text-muted-foreground hover:text-foreground"
                      onClick={() => toggle(l.id)}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-4" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  )}
                </span>
                <span className="font-code font-medium">{l.code}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{l.name}</span>
                {l.type && <Badge tone="neutral">{t(`locations.types.${l.type}`)}</Badge>}
                {l.barcode && (
                  <span className="font-code text-xs text-muted-foreground">{l.barcode}</span>
                )}
                {!l.is_active && <Badge tone="neutral">{t('common.inactive')}</Badge>}
              </li>
            )
          })}
        </ul>
      )}
      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground">{t('locations.keyboardHint')}</p>
      )}
    </div>
  )
}
