import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
  type RowSelectionState,
  type Updater,
} from '@tanstack/react-table'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { EmptyState } from '../EmptyState'
import { DataTablePagination } from './DataTablePagination'
import { DataTableToolbar } from './DataTableToolbar'
import { updateListQuery, type ListQueryState } from './listQuery'
import { useSavedView } from './useSavedView'

declare module '@tanstack/react-table' {
  // Shape is fixed by the library's declaration merging.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Plain-text name for the column menu and resize handle (header may be a node). */
    label?: string
    align?: 'left' | 'right' | 'center'
    /** Renders a select in the toolbar that drives `filter[key]`. */
    filter?: { key?: string; options: { value: string; label: string }[] }
  }
}

// Column value types differ per column; the table only needs the row type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataTableColumn<T> = ColumnDef<T, any>

export interface BulkActionContext {
  selectedIds: string[]
  clear: () => void
}

export interface DataTableProps<T> {
  /** Accessible name of the grid. */
  label: string
  columns: DataTableColumn<T>[]
  data: T[]
  /** Total rows on the server (paginator meta.total). */
  total: number
  query: ListQueryState
  onQueryChange: (next: ListQueryState) => void
  getRowId: (row: T) => string
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  /** Persists column visibility, sizes, density, page size and sort per resource. */
  viewKey?: string
  selectable?: boolean
  bulkActions?: (context: BulkActionContext) => ReactNode
  onRowActivate?: (row: T) => void
  searchable?: boolean
  /** Extra toolbar controls (custom filters, export). */
  toolbar?: ReactNode
  emptyState?: ReactNode
  enableColumnResizing?: boolean
  /** Pages larger than this render through the virtualizer. */
  virtualizeThreshold?: number
  maxHeight?: string
  className?: string
}

const ROW_HEIGHT = { comfortable: 36, compact: 32 } as const
const INTERACTIVE = 'a, button, input, select, textarea, [role="checkbox"], [role="button"]'

function resolve<S>(updater: Updater<S>, prev: S): S {
  return typeof updater === 'function' ? (updater as (old: S) => S)(prev) : updater
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const

export function DataTable<T>({
  label,
  columns,
  data,
  total,
  query,
  onQueryChange,
  getRowId,
  loading = false,
  error = false,
  onRetry,
  viewKey,
  selectable = false,
  bulkActions,
  onRowActivate,
  searchable = true,
  toolbar,
  emptyState,
  enableColumnResizing = false,
  virtualizeThreshold = 50,
  maxHeight = '70vh',
  className,
}: DataTableProps<T>) {
  const { t } = useTranslation('common')
  const { view, update: updateView, reset: resetView } = useSavedView(viewKey ?? null)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [activeIndex, setActiveIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const focusPending = useRef(false)
  const hintId = useId()

  // A new result set (search/filters) invalidates the selection; paging keeps it.
  const scope = JSON.stringify([query.filters, query.q])
  const [selectionScope, setSelectionScope] = useState(scope)
  if (selectionScope !== scope) {
    setSelectionScope(scope)
    setRowSelection({})
  }

  const allColumns = useMemo<DataTableColumn<T>[]>(() => {
    if (!selectable) return columns
    const select: DataTableColumn<T> = {
      id: '__select',
      size: 40,
      minSize: 40,
      enableHiding: false,
      enableResizing: false,
      header: ({ table }) => (
        <Checkbox
          aria-label={t('dataTable.selectPage')}
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={t('dataTable.selectRow')}
          tabIndex={-1}
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
    }
    return [select, ...columns]
  }, [selectable, columns, t])

  // TanStack Table returns fresh functions each render; the compiler cannot memoize around it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId: (row) => getRowId(row),
    state: {
      sorting: query.sort,
      rowSelection,
      columnVisibility: view.columnVisibility,
      columnSizing: view.columnSizing,
    },
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount: total,
    enableMultiSort: true,
    isMultiSortEvent: (e) => (e as MouseEvent).shiftKey,
    enableRowSelection: selectable,
    enableColumnResizing,
    columnResizeMode: 'onChange',
    defaultColumn: { enableSorting: false, sortDescFirst: false, size: 160, minSize: 60 },
    onSortingChange: (updater) => {
      const sort = resolve(updater, query.sort)
      if (viewKey) updateView({ sort })
      onQueryChange(updateListQuery(query, { sort }))
    },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: (updater) =>
      updateView((prev) => ({ columnVisibility: resolve(updater, prev.columnVisibility) })),
    onColumnSizingChange: (updater) =>
      updateView((prev) => ({ columnSizing: resolve(updater, prev.columnSizing) })),
    getCoreRowModel: getCoreRowModel(),
  })

  const rows = table.getRowModel().rows
  const rowHeight = ROW_HEIGHT[view.density]
  const virtualize = rows.length > virtualizeThreshold
  const active = Math.min(activeIndex, Math.max(rows.length - 1, 0))
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    enabled: virtualize,
    // The roving-focus row stays mounted even when scrolled away, so focus is never dropped.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      if (active < range.count && !indexes.includes(active)) {
        indexes.push(active)
        indexes.sort((a, b) => a - b)
      }
      return indexes
    },
  })
  const items = virtualize ? virtualizer.getVirtualItems() : null
  // Each rendered row carries the spacer height before it; the kept-mounted active row can sit
  // far from the visible window, so gaps are filled per row, not just at the ends.
  let cursor = 0
  const visible = items
    ? items.flatMap((item) => {
        const row = rows[item.index]
        const gap = item.start - cursor
        cursor = item.end
        return row ? [{ row, index: item.index, gap }] : []
      })
    : rows.map((row, index) => ({ row, index, gap: 0 }))
  const padBottom = items ? virtualizer.getTotalSize() - cursor : 0
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id])
  const clearSelection = () => setRowSelection({})
  const columnCount = table.getVisibleLeafColumns().length
  const rowOffset = (Math.max(query.page, 1) - 1) * query.perPage

  const focusRow = (index: number) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)
    if (el) {
      focusPending.current = false
      el.focus()
    }
    return Boolean(el)
  }

  // Virtualized rows may not exist until the scroll renders them; focus once they do.
  useEffect(() => {
    if (focusPending.current) focusRow(active)
  })

  const moveTo = (index: number) => {
    if (rows.length === 0) return
    const next = Math.min(Math.max(index, 0), rows.length - 1)
    setActiveIndex(next)
    if (virtualize) virtualizer.scrollToIndex(next)
    if (!focusRow(next)) focusPending.current = true
  }

  const activate = (index: number) => {
    const row = rows[index]
    if (row && onRowActivate) onRowActivate(row.original)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    // Keys typed in embedded inputs, comboboxes or menus belong to them, not to row navigation.
    if (e.defaultPrevented) return
    const rowEl = e.target as HTMLElement
    if (!rowEl.matches('[data-row-index]')) return
    const index = Number(rowEl.dataset.rowIndex)
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 360) / rowHeight) - 1)
    const keys: Record<string, () => void> = {
      ArrowDown: () => moveTo(index + 1),
      ArrowUp: () => moveTo(index - 1),
      PageDown: () => moveTo(index + page),
      PageUp: () => moveTo(index - page),
      Home: () => moveTo(0),
      End: () => moveTo(rows.length - 1),
    }
    if (e.key === 'Enter' && onRowActivate) keys.Enter = () => activate(index)
    if (e.key === ' ' && selectable) keys[' '] = () => rows[index]?.toggleSelected()
    if (e.key === 'Escape' && selectedIds.length > 0) keys.Escape = clearSelection
    const handler = keys[e.key]
    if (handler) {
      e.preventDefault()
      handler()
    }
  }

  const onRowClick = (e: MouseEvent<HTMLTableRowElement>, index: number) => {
    setActiveIndex(index)
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return
    activate(index)
  }

  const fixedLayout = enableColumnResizing
  const showSkeleton = loading && data.length === 0

  let body: ReactNode
  if (error) {
    body = (
      <tr>
        <td colSpan={columnCount} className="px-3 py-10">
          <div role="alert" className="flex flex-col items-center gap-2 text-center">
            <p className="text-sm font-semibold">{t('dataTable.errorTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('states.errorBody')}</p>
            {onRetry && (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                {t('actions.retry')}
              </Button>
            )}
          </div>
        </td>
      </tr>
    )
  } else if (showSkeleton) {
    body = Array.from({ length: Math.min(query.perPage, 8) }, (_, i) => (
      <tr key={`skeleton-${i}`} aria-hidden="true">
        {table.getVisibleLeafColumns().map((col) => (
          <td key={col.id} className="border-b border-border px-3" style={{ height: rowHeight }}>
            <Skeleton className="h-3.5 w-3/4" />
          </td>
        ))}
      </tr>
    ))
  } else if (rows.length === 0) {
    body = (
      <tr>
        <td colSpan={columnCount}>
          {emptyState ?? (
            <EmptyState
              compact
              title={t('dataTable.emptyTitle')}
              description={t('dataTable.emptyBody')}
            />
          )}
        </td>
      </tr>
    )
  } else {
    body = (
      <>
        {visible.map(({ row, index, gap }) => (
          <Fragment key={row.id}>
            {gap > 0 && (
              <tr aria-hidden="true">
                <td colSpan={columnCount} style={{ height: gap, padding: 0 }} />
              </tr>
            )}
            <tr
              data-row-index={index}
              tabIndex={index === active ? 0 : -1}
              aria-rowindex={rowOffset + index + 2}
              aria-selected={selectable ? row.getIsSelected() : undefined}
              onClick={(e) => onRowClick(e, index)}
              onFocus={() => setActiveIndex(index)}
              className={cn(
                'group outline-none',
                onRowActivate && 'cursor-pointer',
                row.getIsSelected() ? 'bg-primary-soft/60' : 'hover:bg-surface-sunken',
                'focus-visible:bg-primary-soft/40 focus-visible:shadow-[inset_2px_0_0_var(--color-ring)]',
              )}
              style={{ height: rowHeight }}
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={cn(
                    'truncate border-b border-border px-3',
                    ALIGN[cell.column.columnDef.meta?.align ?? 'left'],
                  )}
                  style={fixedLayout ? { width: cell.column.getSize() } : undefined}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          </Fragment>
        ))}
        {padBottom > 0 && (
          <tr aria-hidden="true">
            <td colSpan={columnCount} style={{ height: padBottom, padding: 0 }} />
          </tr>
        )}
      </>
    )
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-surface', className)}>
      <DataTableToolbar
        table={table}
        query={query}
        onQueryChange={onQueryChange}
        searchable={searchable}
        density={view.density}
        onDensityChange={(density) => updateView({ density })}
        onResetView={viewKey ? resetView : undefined}
      >
        {toolbar}
      </DataTableToolbar>
      {selectable && selectedIds.length > 0 && (
        <div
          role="region"
          aria-label={t('dataTable.bulkActions')}
          className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft px-3 py-2"
        >
          <p className="text-sm font-medium text-primary-soft-foreground" aria-live="polite">
            {t('dataTable.selected', { count: selectedIds.length })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {bulkActions?.({ selectedIds, clear: clearSelection })}
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clearSelection}>
            {t('dataTable.clearSelection')}
          </Button>
        </div>
      )}
      <div ref={scrollRef} className="relative overflow-auto" style={{ maxHeight }}>
        <table
          role="grid"
          aria-label={label}
          aria-rowcount={total + 1}
          aria-multiselectable={selectable || undefined}
          aria-busy={loading}
          aria-describedby={hintId}
          className={cn(
            'w-full border-separate border-spacing-0 text-table',
            loading && !showSkeleton && 'opacity-60 transition-opacity',
          )}
          style={fixedLayout ? { width: table.getTotalSize(), tableLayout: 'fixed' } : undefined}
        >
          <thead className="sticky top-0 z-10 bg-surface-sunken">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} aria-rowindex={1}>
                {group.headers.map((header) => {
                  const column = header.column
                  const meta = column.columnDef.meta
                  const sorted = column.getIsSorted()
                  const sortable = column.getCanSort()
                  const SortIcon =
                    sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown
                  const content = header.isPlaceholder
                    ? null
                    : flexRender(column.columnDef.header, header.getContext())
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sortable
                          ? sorted === 'asc'
                            ? 'ascending'
                            : sorted === 'desc'
                              ? 'descending'
                              : 'none'
                          : undefined
                      }
                      className={cn(
                        'relative h-row border-b border-border px-3 text-xs font-medium whitespace-nowrap text-muted-foreground',
                        ALIGN[meta?.align ?? 'left'],
                      )}
                      style={fixedLayout ? { width: header.getSize() } : undefined}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={column.getToggleSortingHandler()}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-xs hover:text-foreground',
                            meta?.align === 'right' && 'flex-row-reverse',
                          )}
                        >
                          {content}
                          <SortIcon
                            aria-hidden="true"
                            className={cn('size-3.5', !sorted && 'text-subtle-foreground')}
                          />
                        </button>
                      ) : (
                        content
                      )}
                      {enableColumnResizing && column.getCanResize() && (
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={t('dataTable.resizeColumn', {
                            column: meta?.label ?? column.id,
                          })}
                          aria-valuenow={header.getSize()}
                          tabIndex={0}
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onKeyDown={(e) => {
                            const delta =
                              e.key === 'ArrowRight' ? 16 : e.key === 'ArrowLeft' ? -16 : 0
                            if (!delta) return
                            e.preventDefault()
                            table.setColumnSizing((old) => ({
                              ...old,
                              [column.id]: Math.max(
                                column.columnDef.minSize ?? 60,
                                header.getSize() + delta,
                              ),
                            }))
                          }}
                          className={cn(
                            'absolute top-1 right-0 bottom-1 w-1.5 cursor-col-resize touch-none rounded-xs select-none',
                            'hover:bg-border-strong focus-visible:bg-ring',
                            column.getIsResizing() && 'bg-ring',
                          )}
                        />
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody onKeyDown={onKeyDown}>{body}</tbody>
        </table>
        <p id={hintId} className="sr-only">
          {t('dataTable.keyboardHint')}
        </p>
      </div>
      {loading && (
        <p role="status" className="sr-only">
          {t('dataTable.loading')}
        </p>
      )}
      <DataTablePagination
        query={query}
        total={total}
        onQueryChange={onQueryChange}
        onPerPageChange={(perPage) => viewKey && updateView({ perPage })}
      />
    </div>
  )
}
