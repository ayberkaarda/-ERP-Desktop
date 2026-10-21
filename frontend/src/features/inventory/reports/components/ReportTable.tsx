import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { cn } from '@/lib/utils'
import { isDecimal, trimDecimal } from '../../documents/lib/quantity'
import type { ColDef, ReportData, ReportDef, Row } from '../definitions'
import { stringAt, totalsRow } from '../lib/params'

export const DISPLAY_CAP = 1000

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

const NUMERIC: ColDef['kind'][] = ['qty', 'money', 'cost', 'percent', 'decimal']

/** Report rows as a table with typed formatting, a totals row and kartex devir/closing rows. */
export function ReportTable({ def, data }: { def: ReportDef; data: ReportData }) {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const rows = data.rows ?? []
  const shown = rows.slice(0, DISPLAY_CAP)
  const totals = totalsRow(def.columns, rows, data.totals)

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
      case 'percent':
        return isDecimal(v)
          ? `%${formatDecimalDisplay(v, { locale, minFraction: 2, maxFraction: 2 })}`
          : v
      case 'date':
        return formatDate(v, locale)
      case 'code':
        return <span className="font-code">{v}</span>
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

  /** Kartex devir / closing: label in the first column, balances in theirs. */
  const balanceRow = (label: string, b: Row | null | undefined, testId: string) =>
    b ? (
      <tr className="bg-surface-sunken font-medium" data-testid={testId}>
        {def.columns.map((c, i) => (
          <td
            key={c.key}
            className={cn('px-2 py-1.5', NUMERIC.includes(c.kind) && 'text-right tabular-nums')}
          >
            {i === 0
              ? label
              : c.key === 'balance_quantity'
                ? cell(c, { balance_quantity: stringAt(b, 'quantity') })
                : c.key === 'balance_value'
                  ? cell(c, { balance_value: stringAt(b, 'value') })
                  : ''}
          </td>
        ))}
      </tr>
    ) : null

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table
          className="w-full border-separate border-spacing-0 text-table"
          aria-label={t(`report.${def.id}.title`)}
        >
          <thead className="sticky top-0 bg-surface-sunken text-xs text-muted-foreground">
            <tr>
              {def.columns.map((c) => (
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
            {def.ledger && balanceRow(t('col.opening'), data.opening, 'ledger-opening')}
            {shown.map((row, i) => (
              <tr key={i} className="hover:bg-surface-sunken/60">
                {def.columns.map((c) => (
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
            {def.ledger && balanceRow(t('col.closing'), data.closing, 'ledger-closing')}
          </tbody>
          {totals && !def.ledger && (
            <tfoot>
              <tr className="font-semibold" data-testid="report-totals">
                {def.columns.map((c, i) => (
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
      <p className="text-xs text-muted-foreground">
        {rows.length > DISPLAY_CAP
          ? t('reports.truncated', { count: DISPLAY_CAP })
          : t('reports.rows', { count: rows.length })}
      </p>
    </div>
  )
}
