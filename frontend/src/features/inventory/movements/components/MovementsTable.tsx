import { useVirtualizer } from '@tanstack/react-virtual'
import { Undo2 } from 'lucide-react'
import { useEffect, useRef, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { useFormatters } from '../../stock/lib/format'
import { useInvT } from '../../stock/lib/i18n'
import { itemStockPath, lotPath } from '../../stock/lib/navigation'
import { useWarehouseLookup } from '../../stock/lib/warehouseLookup'
import type { StockMovement } from '../../stock/lib/types'
import { DocumentLink } from './DocumentLink'

const ROW_HEIGHT = 36
/** Below this many rows everything is rendered; above it rows go through the virtualizer. */
const VIRTUALIZE_AT = 100
const COLS = 9

interface MovementsTableProps {
  label: string
  rows: StockMovement[]
  /** Total row count when known (aria-rowcount); unknown with cursor pagination. */
  hasMore?: boolean
  loadingMore?: boolean
  onEndReached?: () => void
  /** Hide the item column (single-item views). */
  hideItem?: boolean
  maxHeight?: string
}

/** Stock ledger rows: signed quantity, cost, source document; virtualized for long ledgers. */
export function MovementsTable({
  label,
  rows,
  hasMore = false,
  loadingMore = false,
  onEndReached,
  hideItem = false,
  maxHeight = '70vh',
}: MovementsTableProps) {
  const t = useInvT()
  const f = useFormatters()
  const warehouseOf = useWarehouseLookup()
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualize = rows.length > VIRTUALIZE_AT
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    enabled: virtualize,
  })
  const items = virtualize ? virtualizer.getVirtualItems() : null
  const lastIndex = items?.at(-1)?.index ?? -1

  // Scrolling near the end of what is loaded asks for the next page.
  useEffect(() => {
    if (virtualize && hasMore && !loadingMore && lastIndex >= rows.length - 20) onEndReached?.()
  }, [virtualize, hasMore, loadingMore, lastIndex, rows.length, onEndReached])

  const cols = hideItem ? COLS - 1 : COLS
  const renderRow = (m: StockMovement, index: number, style?: CSSProperties) => {
    const signed = `${m.direction === 'in' ? '+' : '−'}${f.qty(m.quantity)}`
    return (
      <tr
        key={m.id}
        aria-rowindex={index + 2}
        className="border-t border-border"
        style={style}
        data-movement-id={m.id}
      >
        <td className="px-2 py-1 font-code text-xs text-muted-foreground tabular-nums">{m.seq}</td>
        <td className="px-2 py-1 whitespace-nowrap tabular-nums">
          {formatDate(m.occurred_at, f.locale)}
        </td>
        <td className="px-2 py-1 whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5">
            {t(`movementTypes.${m.movement_type}`)}
            {m.reverses_id && (
              <Badge tone="warning">
                <Undo2 aria-hidden="true" />
                {t('movements.reversal')}
              </Badge>
            )}
          </span>
        </td>
        {!hideItem && (
          <td className="max-w-72 truncate px-2 py-1">
            <Link
              to={itemStockPath(m.item_id)}
              className="hover:underline"
              title={m.item_name ?? undefined}
            >
              <span className="font-code">{m.item_code}</span>{' '}
              <span className="text-muted-foreground">{m.item_name}</span>
            </Link>
          </td>
        )}
        <td className="px-2 py-1 whitespace-nowrap">
          <span className="font-code" title={warehouseOf(m.warehouse_id)?.name}>
            {warehouseOf(m.warehouse_id)?.code ?? '—'}
          </span>
        </td>
        <td className="px-2 py-1 whitespace-nowrap">
          {m.lot_id ? (
            <Link to={lotPath(m.lot_id)} className="font-code hover:underline">
              {m.lot_no ?? m.lot_id}
            </Link>
          ) : null}
          {m.serial_no && <span className="font-code text-muted-foreground"> #{m.serial_no}</span>}
        </td>
        <td
          className={cn(
            'px-2 py-1 text-right font-medium whitespace-nowrap tabular-nums',
            m.direction === 'in' ? 'text-success' : 'text-danger',
          )}
        >
          <span aria-hidden="true">{signed}</span>
          <span className="sr-only">
            {t(m.direction === 'in' ? 'movements.inQty' : 'movements.outQty', {
              qty: f.qty(m.quantity),
            })}
          </span>
        </td>
        <td className="px-2 py-1 text-right whitespace-nowrap tabular-nums">
          <span className="block">{f.money(m.total_cost)}</span>
          <span className="block text-2xs text-muted-foreground">{f.cost(m.unit_cost)}</span>
        </td>
        <td className="px-2 py-1 whitespace-nowrap">
          <DocumentLink movement={m} />
        </td>
      </tr>
    )
  }

  const padTop = items?.[0]?.start ?? 0
  const padBottom = items ? virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0) : 0
  const thClass = 'px-2 text-left font-medium'

  return (
    <div
      ref={scrollRef}
      className="overflow-auto rounded-lg border border-border bg-surface"
      style={{ maxHeight }}
    >
      <table
        className="w-full text-table"
        aria-label={label}
        aria-rowcount={hasMore ? -1 : rows.length + 1}
      >
        <thead className="sticky top-0 z-10 bg-surface-sunken text-xs text-muted-foreground">
          <tr aria-rowindex={1} className="h-row">
            <th scope="col" className={thClass}>
              {t('movements.seq')}
            </th>
            <th scope="col" className={thClass}>
              {t('fields.occurredAt')}
            </th>
            <th scope="col" className={thClass}>
              {t('fields.movementType')}
            </th>
            {!hideItem && (
              <th scope="col" className={thClass}>
                {t('fields.item')}
              </th>
            )}
            <th scope="col" className={thClass}>
              {t('fields.warehouse')}
            </th>
            <th scope="col" className={thClass}>
              {t('fields.lotSerial')}
            </th>
            <th scope="col" className={cn(thClass, 'text-right')}>
              {t('fields.quantity')}
            </th>
            <th scope="col" className={cn(thClass, 'text-right')}>
              {t('fields.cost')}
            </th>
            <th scope="col" className={thClass}>
              {t('fields.document')}
            </th>
          </tr>
        </thead>
        <tbody>
          {items ? (
            <>
              {padTop > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={cols} style={{ height: padTop, padding: 0 }} />
                </tr>
              )}
              {items.map((v) => {
                const row = rows[v.index]
                return row ? renderRow(row, v.index, { height: ROW_HEIGHT }) : null
              })}
              {padBottom > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={cols} style={{ height: padBottom, padding: 0 }} />
                </tr>
              )}
            </>
          ) : (
            rows.map((row, i) => renderRow(row, i))
          )}
        </tbody>
      </table>
    </div>
  )
}
