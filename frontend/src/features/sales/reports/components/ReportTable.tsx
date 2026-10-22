import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { DELIVERIES_BASE, INVOICES_BASE, LINK_PATHS } from '../../invoices/kit/links'
import { isDecimal, money, percent, qty } from '../../invoices/kit/money'
import type { ColDef, ColLabel, ReportDef, Row } from '../definitions'
import { stringAt } from '../lib/params'

const NUMERIC: ColDef['kind'][] = ['qty', 'money', 'percent', 'integer']

const LINK_BASE = {
  order: LINK_PATHS.sales_order,
  delivery: DELIVERIES_BASE,
  invoice: INVOICES_BASE,
} as const

/** Ageing bucket values -> their column labels. */
const BUCKET_LABEL: Record<string, ColLabel> = {
  not_due: 'notDue',
  days_0_30: 'days0to30',
  days_31_60: 'days31to60',
  days_61_90: 'days61to90',
  days_over_90: 'daysOver90',
}

interface ReportTableProps {
  def: ReportDef
  columns: ColDef[]
  rows: Row[]
  totals: Row | null
}

/** Report rows with typed formatting, document links and the totals row. */
export function ReportTable({ def, columns, rows, totals }: ReportTableProps) {
  const { t } = useTranslation('sales-reports')
  const locale = useIntlLocale()

  const cell = (c: ColDef, row: Row): ReactNode => {
    const v = stringAt(row, c.key)
    if (v === '') return ''
    switch (c.kind) {
      case 'qty':
        return qty(v, locale) || v
      case 'money':
        return money(v, locale) || v
      case 'percent':
        return percent(v, locale) || v
      case 'integer':
        return v
      case 'date':
        return formatDate(v, locale)
      case 'code':
        return <span className="font-code">{v}</span>
      case 'document': {
        const id = c.idKey ? stringAt(row, c.idKey) : ''
        return id && c.link ? (
          <Link
            to={`${LINK_BASE[c.link]}/${encodeURIComponent(id)}`}
            className="font-code text-primary hover:underline"
          >
            {v}
          </Link>
        ) : (
          <span className="font-code">{v}</span>
        )
      }
      case 'bucket':
        return BUCKET_LABEL[v] ? t(`col.${BUCKET_LABEL[v]}`) : v
      case 'text':
        return v
    }
  }

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
                  {i === 0
                    ? t('hub.total')
                    : isDecimal(stringAt(totals, c.key))
                      ? cell(c, totals)
                      : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
