import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { isDecimal, money, percent, qty } from '@/features/sales/invoices/kit/money'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { hasPermission, usePermissionContext } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import type { ColDef, ColLabel, ReportDef, Row } from '../definitions'
import { stringAt } from '../lib/params'
import { LINK_TARGETS, linkTarget, ratioToPercent } from '../lib/values'

const NUMERIC: ColDef['kind'][] = ['qty', 'money', 'percent', 'ratio', 'integer', 'decimal']

const BUCKET_LABEL: Record<string, ColLabel> = {
  not_due: 'notDue',
  days_0_30: 'days0to30',
  days_31_60: 'days31to60',
  days_61_90: 'days61to90',
  days_over_90: 'daysOver90',
}

const SOURCES = ['invoice', 'debit_note', 'return'] as const

interface ReportTableProps {
  def: ReportDef
  columns: ColDef[]
  rows: Row[]
  totals: Row | null
}

/**
 * Report rows with typed formatting, the totals row and document links; a link is plain text
 * when the user may not open its target (each document needs its own view permission).
 */
export function ReportTable({ def, columns, rows, totals }: ReportTableProps) {
  const { t } = useTranslation('purchasing-reports')
  const locale = useIntlLocale()
  const ctx = usePermissionContext()

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
      case 'ratio':
        return percent(ratioToPercent(v), locale) || v
      case 'decimal':
        return isDecimal(v)
          ? formatDecimalDisplay(v, { locale, minFraction: 0, maxFraction: 1 })
          : v
      case 'integer':
        return v
      case 'date':
        return formatDate(v, locale)
      case 'code':
        return <span className="font-code">{v}</span>
      case 'source':
        return (SOURCES as readonly string[]).includes(v)
          ? t(`source.${v as (typeof SOURCES)[number]}`)
          : v
      case 'bucket':
        return BUCKET_LABEL[v] ? t(`col.${BUCKET_LABEL[v]}`) : v
      case 'document': {
        const id = c.idKey ? stringAt(row, c.idKey) : ''
        const target = c.link ? linkTarget(c.link, row) : null
        const allowed = target !== null && hasPermission(ctx, LINK_TARGETS[target].permission)
        return id && target && allowed ? (
          <Link
            to={`${LINK_TARGETS[target].base}/${encodeURIComponent(id)}`}
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
