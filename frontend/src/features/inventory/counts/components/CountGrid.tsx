import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { DecimalInput } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { cn } from '@/lib/utils'
import { trimDecimal } from '../../documents/lib/quantity'
import type { StockDocumentLine } from '../../documents/types'
import {
  countCost,
  countedOf,
  isPendingLine,
  lineVariance,
  varianceValue,
  type Counts,
} from '../lib/variance'

export const COUNT_PAGE_SIZE = 100

interface CountGridProps {
  lines: StockDocumentLine[]
  counts: Counts
  onChange: (lineId: string, value: string) => void
  disabled?: boolean
  /** Restart on page 1 when the filter changes. */
  resetKey?: string
}

/**
 * Count entry grid: one counted-quantity input per line. Enter / ArrowDown move to the next
 * line, Shift+Enter / ArrowUp to the previous one, crossing page boundaries; Ctrl+Home and
 * Ctrl+End jump to the first and last line. Variance and its value update as you type.
 */
export function CountGrid({
  lines,
  counts,
  onChange,
  disabled = false,
  resetKey = '',
}: CountGridProps) {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const tableRef = useRef<HTMLTableElement>(null)
  const [page, setPage] = useState(0)
  const [seenKey, setSeenKey] = useState(resetKey)
  const pendingFocus = useRef<number | null>(null)
  const pages = Math.max(1, Math.ceil(lines.length / COUNT_PAGE_SIZE))
  if (seenKey !== resetKey) {
    setSeenKey(resetKey)
    setPage(0)
  }
  const current = Math.min(page, pages - 1)
  const start = current * COUNT_PAGE_SIZE
  const visible = lines.slice(start, start + COUNT_PAGE_SIZE)

  const qty = (v: string | null | undefined) =>
    v ? formatDecimalDisplay(trimDecimal(v), { locale, minFraction: 0, maxFraction: 6 }) : ''
  const money = (v: string) => formatDecimalDisplay(v, { locale })

  const focusRow = (index: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`[data-count-row="${index}"]`)
    if (!el) return false
    el.focus()
    el.select()
    return true
  }

  useEffect(() => {
    if (pendingFocus.current !== null && focusRow(pendingFocus.current)) pendingFocus.current = null
  })

  /**
   * Moves to the editable line at absolute index `target` (or the next one in `step`'s
   * direction: pending lines have no input), switching page when needed.
   */
  const go = (start: number, step: 1 | -1) => {
    let target = start
    const pendingAt = (i: number) => {
      const l = i >= 0 ? lines[i] : undefined
      return l !== undefined && isPendingLine(l)
    }
    while (pendingAt(target)) target += step
    if (target < 0 || target >= lines.length) return
    const targetPage = Math.floor(target / COUNT_PAGE_SIZE)
    if (targetPage !== current) {
      pendingFocus.current = target
      setPage(targetPage)
    } else {
      focusRow(target)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const back = e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)
      go(index + (back ? -1 : 1), back ? -1 : 1)
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Home') {
      e.preventDefault()
      go(0, 1)
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'End') {
      e.preventDefault()
      go(lines.length - 1, -1)
    }
  }

  const th = 'h-row border-b border-border px-2 font-medium whitespace-nowrap'
  const td = 'border-b border-border px-2 py-1 align-middle'

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table
          ref={tableRef}
          className="w-full border-separate border-spacing-0 text-table"
          aria-label={t('view.lines')}
        >
          <thead className="bg-surface-sunken text-xs text-muted-foreground">
            <tr>
              <th scope="col" className={cn(th, 'w-10 text-right')}>
                #
              </th>
              <th scope="col" className={cn(th, 'text-left')}>
                {t('lines.item')}
              </th>
              <th scope="col" className={cn(th, 'text-left')}>
                {t('lines.lot')}
              </th>
              <th scope="col" className={cn(th, 'text-left')}>
                {t('lines.location')}
              </th>
              <th scope="col" className={cn(th, 'text-left')}>
                {t('lines.unit')}
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                {t('count.system')}
              </th>
              <th scope="col" className={cn(th, 'w-40 text-right')}>
                {t('count.counted')}
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                {t('count.variance')}
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                {t('count.avgCost')}
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                {t('count.varianceValue')}
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l, i) => {
              const index = start + i
              const pending = isPendingLine(l)
              // Pending lines have no id yet: key them by position so they never collide.
              const rowKey = pending ? `pending-${String(index)}` : l.id
              const counted = countedOf(l, counts)
              const variance = lineVariance(l, counted)
              const value = varianceValue(l, counted)
              const tone =
                variance === null || variance.isZero()
                  ? ''
                  : variance.isNegative()
                    ? 'text-danger'
                    : 'text-success'
              const label = `${l.item_code ?? ''} ${l.lot_no ?? ''}`.trim()
              return (
                <tr key={rowKey} data-testid={`count-row-${rowKey}`}>
                  <td className={cn(td, 'text-right text-xs text-muted-foreground')}>
                    {l.line_no}
                  </td>
                  <td className={td}>
                    <span className="font-code">{l.item_code}</span> {l.item_name}
                  </td>
                  <td className={cn(td, 'font-code')}>{l.lot_no}</td>
                  <td className={td}>{l.location_code}</td>
                  <td className={td}>{l.unit_code}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{qty(l.system_quantity)}</td>
                  <td className={cn(td, 'text-right')}>
                    {pending ? (
                      <div className="space-y-1">
                        <DecimalInput
                          scale={6}
                          displayMinFraction={0}
                          value={counted}
                          locale={locale}
                          disabled
                          aria-label={t('count.counted') + ', ' + label}
                          aria-describedby={`${rowKey}-note`}
                          className="h-control-sm"
                          onChange={() => undefined}
                        />
                        <p
                          id={`${rowKey}-note`}
                          className="text-xs whitespace-nowrap text-warning-soft-foreground"
                          data-testid={`pending-${rowKey}`}
                        >
                          {t('count.pendingLine')}
                        </p>
                      </div>
                    ) : (
                      <DecimalInput
                        scale={6}
                        displayMinFraction={0}
                        value={counted}
                        locale={locale}
                        disabled={disabled}
                        data-count-row={index}
                        aria-label={t('count.counted') + ', ' + label}
                        className="h-control-sm"
                        onChange={(v) => onChange(l.id, v)}
                        onKeyDown={(e) => onKeyDown(e, index)}
                      />
                    )}
                  </td>
                  <td
                    className={cn(td, 'text-right tabular-nums', tone)}
                    data-testid={`variance-${rowKey}`}
                  >
                    {variance ? qty(variance.toString()) : ''}
                  </td>
                  <td className={cn(td, 'text-right tabular-nums')}>
                    {countCost(l) ? money(countCost(l) ?? '0') : ''}
                  </td>
                  <td className={cn(td, 'text-right tabular-nums', tone)}>
                    {value ? money(value.toFixed()) : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={current === 0}
            aria-label={t('count.prevPage')}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="tabular-nums">{t('count.page', { page: current + 1, pages })}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={current >= pages - 1}
            aria-label={t('count.nextPage')}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  )
}
