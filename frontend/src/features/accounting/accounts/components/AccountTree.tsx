import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, CornerDownRight, Pencil } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AccountTypeBadge } from '../../shared/components'
import { useAccT } from '../../shared/i18n'
import type { Account } from '../../shared/types'
import type { VisibleRow } from '../lib/tree'

const ROW_HEIGHT = 36
/** Smaller charts render every row; larger ones go through the virtualizer. */
export const VIRTUALIZE_AFTER = 200

interface AccountTreeProps {
  rows: readonly VisibleRow[]
  label: string
  selectedId: string | null
  onSelect: (account: Account) => void
  onToggle: (id: string, open: boolean) => void
  onEdit?: (account: Account) => void
  onAddChild?: (account: Account) => void
  maxHeight?: string
}

/**
 * Chart of accounts as a WAI-ARIA tree with one tab stop; focus stays on the tree and the active
 * row is announced through aria-activedescendant, so virtualized rows never lose focus.
 * Up/Down/PageUp/PageDown/Home/End move, Right expands or enters, Left collapses or goes to the
 * parent, Enter selects (detail panel), Space toggles, F2 edits, Insert adds a sub-account.
 */
export function AccountTree({
  rows,
  label,
  selectedId,
  onSelect,
  onToggle,
  onEdit,
  onAddChild,
  maxHeight = '65vh',
}: AccountTreeProps) {
  const t = useAccT()
  const baseId = useId()
  const hintId = `${baseId}-hint`
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeIndex = Math.max(
    0,
    rows.findIndex((r) => r.account.id === (activeId ?? selectedId)),
  )
  const active = rows[activeIndex]
  const virtualize = rows.length > VIRTUALIZE_AFTER

  // The virtualizer returns fresh functions each render; the compiler cannot memoize around it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    enabled: virtualize,
    // The active row stays mounted so aria-activedescendant always points at a real element.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      if (activeIndex < range.count && !indexes.includes(activeIndex)) {
        indexes.push(activeIndex)
        indexes.sort((a, b) => a - b)
      }
      return indexes
    },
  })

  // Keep the active row in view when it changes from the keyboard.
  useEffect(() => {
    if (!virtualize || !active) return
    virtualizer.scrollToIndex(activeIndex, { align: 'auto' })
  }, [activeIndex, virtualize, active, virtualizer])

  const rowId = (id: string) => `${baseId}-row-${id}`

  const moveTo = (index: number) => {
    if (rows.length === 0) return
    const next = rows[Math.min(Math.max(index, 0), rows.length - 1)]
    if (next) setActiveId(next.account.id)
    if (!virtualize && next) {
      const el = document.getElementById(rowId(next.account.id))
      // jsdom has no scrollIntoView.
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !active) return
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_HEIGHT) - 1)
    const a = active.account
    const keys: Record<string, () => void> = {
      ArrowDown: () => moveTo(activeIndex + 1),
      ArrowUp: () => moveTo(activeIndex - 1),
      PageDown: () => moveTo(activeIndex + page),
      PageUp: () => moveTo(activeIndex - page),
      Home: () => moveTo(0),
      End: () => moveTo(rows.length - 1),
      ArrowRight: () => {
        if (active.hasChildren && !active.expanded) onToggle(a.id, true)
        else if (active.hasChildren) moveTo(activeIndex + 1)
      },
      ArrowLeft: () => {
        if (active.hasChildren && active.expanded) onToggle(a.id, false)
        else if (active.parentId) moveTo(rows.findIndex((r) => r.account.id === active.parentId))
      },
      Enter: () => onSelect(a),
      ' ': () => active.hasChildren && onToggle(a.id, !active.expanded),
    }
    if (onEdit) keys.F2 = () => onEdit(a)
    if (onAddChild) keys.Insert = () => onAddChild(a)
    const handler = keys[e.key]
    if (handler) {
      e.preventDefault()
      handler()
    }
  }

  const items = virtualize
    ? virtualizer.getVirtualItems().map((v) => ({ index: v.index, start: v.start }))
    : rows.map((_, index) => ({ index, start: index * ROW_HEIGHT }))
  const total = virtualize ? virtualizer.getTotalSize() : rows.length * ROW_HEIGHT

  return (
    <div className="rounded-md border border-border bg-surface">
      <div
        aria-hidden="true"
        className="grid grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,2fr)_8rem_7rem_8rem] gap-2 border-b border-border bg-surface-sunken px-3 py-2 text-xs font-medium text-muted-foreground max-md:hidden"
      >
        <span>{t('accounts.fields.code')}</span>
        <span>{t('accounts.fields.name')}</span>
        <span>{t('accounts.fields.type')}</span>
        <span>{t('accounts.fields.normalBalance')}</span>
        <span className="text-right">{t('common.actions')}</span>
      </div>
      <div
        ref={scrollRef}
        role="tree"
        aria-label={label}
        aria-describedby={hintId}
        aria-activedescendant={active ? rowId(active.account.id) : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        style={{ maxHeight }}
      >
        <div style={{ height: total, position: 'relative' }}>
          {items.map(({ index, start }) => {
            const row = rows[index]
            if (!row) return null
            const a = row.account
            const isActive = index === activeIndex
            const isSelected = a.id === selectedId
            return (
              <div
                key={a.id}
                id={rowId(a.id)}
                role="treeitem"
                aria-label={[
                  a.code,
                  a.name,
                  t(`accounts.types.${a.type}`),
                  a.is_postable ? null : t('accounts.header'),
                  a.is_active ? null : t('accounts.inactive'),
                ]
                  .filter(Boolean)
                  .join(', ')}
                aria-level={row.depth}
                aria-posinset={row.posinset}
                aria-setsize={row.setsize}
                aria-expanded={row.hasChildren ? row.expanded : undefined}
                aria-selected={isSelected}
                data-active={isActive || undefined}
                onClick={() => {
                  setActiveId(a.id)
                  onSelect(a)
                }}
                className={cn(
                  'absolute inset-x-0 grid cursor-default grid-cols-[minmax(12rem,1.2fr)_minmax(10rem,2fr)_8rem_7rem_8rem] items-center gap-2 border-b border-border px-3 text-table max-md:grid-cols-[1fr_auto]',
                  isSelected && 'bg-primary-soft/60',
                  isActive && 'outline-2 -outline-offset-2 outline-ring/60',
                  row.context && 'text-muted-foreground',
                  !a.is_active && 'opacity-70',
                )}
                style={{ top: start, height: ROW_HEIGHT }}
              >
                <span
                  className="flex min-w-0 items-center gap-1"
                  style={{ paddingLeft: `${(row.depth - 1) * 1.25}rem` }}
                >
                  {row.hasChildren ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label={t(
                        row.expanded ? 'accounts.tree.collapse' : 'accounts.tree.expand',
                        {
                          code: a.code,
                        },
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggle(a.id, !row.expanded)
                      }}
                    >
                      {row.expanded ? (
                        <ChevronDown aria-hidden="true" />
                      ) : (
                        <ChevronRight aria-hidden="true" />
                      )}
                    </Button>
                  ) : (
                    <span className="size-control-sm shrink-0" aria-hidden="true" />
                  )}
                  <span className={cn('font-code', !a.is_postable && 'font-semibold')}>
                    {a.code}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-2 max-md:hidden">
                  <span className="truncate">{a.name}</span>
                  {!a.is_postable && <Badge>{t('accounts.header')}</Badge>}
                  {!a.is_active && <Badge tone="warning">{t('accounts.inactive')}</Badge>}
                  {a.currency_code && <Badge tone="info">{a.currency_code}</Badge>}
                </span>
                <span className="max-md:hidden">
                  <AccountTypeBadge type={a.type} />
                </span>
                <span className="text-muted-foreground max-md:hidden">
                  {t(`accounts.normal.${a.normal_balance}`)}
                </span>
                <span className="flex justify-end gap-0.5">
                  {onAddChild && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label={t('accounts.addChildNamed', { code: a.code })}
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddChild(a)
                      }}
                    >
                      <CornerDownRight aria-hidden="true" />
                    </Button>
                  )}
                  {onEdit && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      tabIndex={-1}
                      aria-label={t('accounts.editNamed', { code: a.code })}
                      onClick={(e) => {
                        e.stopPropagation()
                        onEdit(a)
                      }}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      <p id={hintId} className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
        {t('accounts.tree.hint')}
      </p>
    </div>
  )
}
