import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useUnits } from '../../documents/hooks/queries'
import { isDecimal, trimDecimal } from '../../documents/lib/quantity'
import type { ColDef, ReportDef, Row } from '../definitions'
import { stringAt, totalsRow } from '../lib/params'

const MOVEMENTS = [
  'receipt',
  'issue',
  'transfer_out',
  'transfer_in',
  'count_adjustment',
  'opening',
  'return_in',
  'return_out',
  'production_in',
  'production_out',
  'scrap',
] as const

const NUMERIC: ColDef['kind'][] = ['qty', 'money', 'cost', 'percent', 'decimal', 'integer', 'days']

interface ReportTableProps {
  def: ReportDef
  columns: ColDef[]
  rows: Row[]
  meta: Row
  /** Kartex: the devir row belongs to the first page, the closing row to the last. */
  firstPage: boolean
  lastPage: boolean
}

/** Report rows with typed formatting, the API totals and the kartex devir/closing rows. */
export function ReportTable({ def, columns, rows, meta, firstPage, lastPage }: ReportTableProps) {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const units = useUnits().data
  const totals = def.ledger ? null : totalsRow(columns, meta)

  const cell = (c: ColDef, row: Row): ReactNode => {
    const v = stringAt(row, c.key)
    if (v === '') return ''
    switch (c.kind) {
      case 'qty':
        return isDecimal(v)
          ? formatDecimalDisplay(trimDecimal(v), { locale, minFraction: 0, maxFraction: 6 })
          : v
      case 'money':
        return isDecimal(v) ? formatDecimalDisplay(v, { locale }) : v
      case 'cost':
        return isDecimal(v)
          ? formatDecimalDisplay(trimDecimal(v), { locale, minFraction: 2, maxFraction: 6 })
          : v
      case 'decimal':
        return isDecimal(v)
          ? formatDecimalDisplay(trimDecimal(v), { locale, minFraction: 0, maxFraction: 2 })
          : v
      case 'integer':
        return v
      case 'days':
        return row.expired === true ? (
          <span className="inline-flex items-center gap-1.5">
            <Badge tone="danger">{t('reports.expired')}</Badge>
            {v}
          </span>
        ) : (
          v
        )
      case 'percent':
        return isDecimal(v)
          ? `%${formatDecimalDisplay(v, { locale, minFraction: 2, maxFraction: 2 })}`
          : v
      case 'date':
        return formatDate(v, locale)
      case 'code':
        return <span className="font-code">{v}</span>
      case 'unit':
        return units?.find((u) => u.id === v)?.code ?? ''
      case 'class':
        return <Badge tone={v === 'A' ? 'success' : v === 'B' ? 'info' : 'neutral'}>{v}</Badge>
      case 'movement': {
        const known = MOVEMENTS.find((m) => m === v)
        return known ? t(`movementType.${known}`) : v
      }
      case 'document': {
        const id = stringAt(row, 'document_id')
        return id && stringAt(row, 'document_type') === 'stock_document' ? (
          <Link
            to={`/inventory/documents/${id}`}
            className="font-code text-primary hover:underline"
          >
            {v}
          </Link>
        ) : (
          <span className="font-code">{v}</span>
        )
      }
      case 'text':
        return v
    }
  }

  const asRow = (value: unknown): Row | null =>
    value !== null && typeof value === 'object' ? (value as Row) : null

  /** Kartex devir / closing: label in the first column, balances (and range totals) in theirs. */
  const balanceRow = (label: string, balance: Row | null, sums: Row | null, testId: string) =>
    balance ? (
      <tr className="bg-surface-sunken font-medium" data-testid={testId}>
        {columns.map((c, i) => {
          const values: Row = {
            ...(sums ?? {}),
            balance_quantity: balance.quantity,
            balance_value: balance.value,
            balance_avg_cost: balance.avg_cost,
          }
          const shown = c.key.startsWith('balance_') || (sums && c.total)
          return (
            <td
              key={c.key}
              className={cn('px-2 py-1.5', NUMERIC.includes(c.kind) && 'text-right tabular-nums')}
            >
              {i === 0 ? label : shown ? cell(c, values) : ''}
            </td>
          )
        })}
      </tr>
    ) : null

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table
        className="w-full border-separate border-spacing-0 text-table"
        aria-label={t(`report.${def.id}.title`)}
      >
        <thead className="sticky top-0 bg-surface-sunken text-xs text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'h-row border-b border-border px-2 font-medium whitespace-nowrap',
                  NUMERIC.includes(c.kind) ? 'text-right' : 'text-left',
                )}
              >
                {t(`col.${c.label}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {def.ledger &&
            firstPage &&
            balanceRow(t('col.opening'), asRow(meta.opening), null, 'ledger-opening')}
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-surface-sunken/60">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'border-b border-border px-2 py-1',
                    NUMERIC.includes(c.kind) && 'text-right tabular-nums',
                  )}
                >
                  {cell(c, row)}
                </td>
              ))}
            </tr>
          ))}
          {def.ledger &&
            lastPage &&
            balanceRow(t('col.closing'), asRow(meta.closing), asRow(meta.totals), 'ledger-closing')}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="font-semibold" data-testid="report-totals">
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={cn(
                    'border-t border-border bg-surface-sunken px-2 py-1.5',
                    NUMERIC.includes(c.kind) && 'text-right tabular-nums',
                  )}
                >
                  {i === 0 ? t('reports.total') : c.total ? cell(c, totals) : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
