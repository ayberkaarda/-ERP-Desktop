import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { useDebouncedValue } from '@/components/shared/hooks/useDebouncedValue'
import { DateInput, FieldShell } from '@/components/shared/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { dec, money } from '@/features/sales/invoices/kit/money'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { isApiError } from '@/platform'
import { INVOICES_BASE, ORDERS_BASE } from '../../invoices/kit/links'
import { PURCH_OPEN, PURCH_PERMS } from '../../invoices/kit/permissions'
import type { ApiLink } from '../../invoices/kit/types'
import {
  lastTwelveMonths,
  ratePercent,
  rateTone,
  useSupplierPerformance,
  useSupplierSummary,
} from '../lib/supplier'

function Stat({
  label,
  value,
  testId,
  tone,
}: {
  label: string
  value: ReactNode
  testId?: string
  tone?: 'danger'
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          tone === 'danger'
            ? 'text-lg font-semibold text-danger tabular-nums'
            : 'text-lg font-semibold tabular-nums'
        }
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * Parties "Purchasing" tab of a supplier: exposure (open payables + open orders), invoiced and
 * debited totals, balance due, delivery performance over a period (on-time, fill, lead time,
 * price variance, returns) and the latest orders and invoices.
 * GET /suppliers/{id}/purchase-summary and /suppliers/{id}/performance?from=&to=.
 */
export function SupplierPurchaseSummary({ partyId }: { partyId: string }) {
  const { t } = useTranslation('purchasing-reports')
  const locale = useIntlLocale()
  const allowed = usePermission(PURCH_OPEN.supplierSummary)
  const canInvoices = usePermission(PURCH_PERMS.invoices.view)
  const [range, setRange] = useState(lastTwelveMonths)
  const summary = useSupplierSummary(partyId, allowed)
  // Typing a date emits every keystroke; ask the API once the range settles.
  const settled = useDebouncedValue(range, 400)
  const performance = useSupplierPerformance(partyId, settled, allowed)

  if (!allowed) return <EmptyState description={t('supplier.noAccess')} />
  if (summary.isError) {
    return (
      <div
        role="alert"
        className="space-y-2 rounded-lg border border-border bg-surface py-8 text-center text-sm"
      >
        <p className="font-medium">{t('supplier.loadFailed')}</p>
        {isApiError(summary.error) && summary.error.message && (
          <p className="text-muted-foreground">{summary.error.message}</p>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => void summary.refetch()}>
          {t('supplier.retry')}
        </Button>
      </div>
    )
  }
  if (!summary.data) return <Skeleton className="h-48 w-full" />
  const s = summary.data
  const cur = s.currency
  const overdue = dec(s.exposure.overdue_payables).greaterThan(0)
  const p = performance.data
  const onTime = ratePercent(p?.on_time_rate)
  const fill = ratePercent(p?.fill_rate)
  const returns = ratePercent(p?.return_rate)
  const pctText = (v: string | null) =>
    v === null ? '—' : `%${formatDecimalDisplay(v, { locale, minFraction: 0, maxFraction: 1 })}`

  const docList = (
    title: string,
    rows: (ApiLink & { balance_due?: string })[],
    basePath: string,
    testId: string,
  ) => (
    <section aria-label={title} className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('supplier.none')}</p>
      ) : (
        <ul className="space-y-1 text-sm" data-testid={testId}>
          {rows.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
              <Link
                to={`${basePath}/${encodeURIComponent(d.id)}`}
                className="font-code text-primary hover:underline"
              >
                {d.number ?? t('supplier.unnumbered')}
              </Link>
              <span className="text-xs text-muted-foreground">
                {d.document_date ? formatDate(d.document_date, locale) : ''}
              </span>
              <span className="tabular-nums">{money(d.total, locale, d.currency_code)}</span>
              {d.balance_due !== undefined && !dec(d.balance_due).isZero() && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t('supplier.balance', { amount: money(d.balance_due, locale) })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  return (
    <section aria-label={t('supplier.title')} className="space-y-4" data-testid="supplier-summary">
      {canInvoices && (
        <div className="flex justify-end">
          <Link
            to={`${INVOICES_BASE}?filter%5Bparty_id%5D=${encodeURIComponent(partyId)}`}
            className="text-sm text-primary hover:underline"
          >
            {t('supplier.allInvoices')}
          </Link>
        </div>
      )}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('supplier.exposure')}
          value={money(s.exposure.total, locale, cur)}
          testId="supplier-exposure-total"
        />
        <Stat
          label={t('supplier.openPayables')}
          value={money(s.exposure.open_payables, locale, cur)}
        />
        <Stat
          label={t('supplier.overduePayables')}
          value={money(s.exposure.overdue_payables, locale, cur)}
          tone={overdue ? 'danger' : undefined}
          testId="supplier-overdue"
        />
        <Stat
          label={t('supplier.openOrders')}
          value={t('supplier.openOrdersValue', {
            count: s.orders.open_count,
            amount: money(s.orders.open_value, locale, cur),
          })}
        />
        <Stat
          label={t('supplier.invoiced')}
          value={money(s.invoices.invoiced_total, locale, cur)}
        />
        <Stat label={t('supplier.debited')} value={money(s.invoices.debited_total, locale, cur)} />
        <Stat
          label={t('supplier.balanceDue')}
          value={money(s.invoices.balance_due, locale, cur)}
          testId="supplier-balance"
        />
        <Stat
          label={t('supplier.lastInvoice')}
          value={
            s.invoices.last_invoice_date ? formatDate(s.invoices.last_invoice_date, locale) : '—'
          }
        />
      </dl>
      <section
        aria-label={t('supplier.performance')}
        className="space-y-3 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-sm font-semibold">{t('supplier.performance')}</h3>
          <div className="flex items-end gap-2">
            <FieldShell label={t('supplier.from')} className="w-40">
              {(control) => (
                <DateInput
                  {...control}
                  value={range.from}
                  max={range.to}
                  onChange={(v) => setRange((r) => ({ ...r, from: v }))}
                />
              )}
            </FieldShell>
            <FieldShell label={t('supplier.to')} className="w-40">
              {(control) => (
                <DateInput
                  {...control}
                  value={range.to}
                  min={range.from}
                  onChange={(v) => setRange((r) => ({ ...r, to: v }))}
                />
              )}
            </FieldShell>
          </div>
        </div>
        {performance.isError ? (
          <p role="alert" className="text-sm text-danger">
            {t('supplier.performanceFailed')}
          </p>
        ) : !p ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <dl
            className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6"
            data-testid="supplier-performance"
          >
            <div>
              <dt className="text-xs text-muted-foreground">{t('supplier.orders')}</dt>
              <dd className="tabular-nums">{p.orders}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('supplier.onTime')}</dt>
              <dd>
                <Badge tone={rateTone('higher_better', onTime)}>{pctText(onTime)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('supplier.fill')}</dt>
              <dd>
                <Badge tone={rateTone('higher_better', fill)}>{pctText(fill)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('supplier.leadDays')}</dt>
              <dd className="tabular-nums">
                {p.avg_lead_days === null
                  ? '—'
                  : t('supplier.days', {
                      days: formatDecimalDisplay(p.avg_lead_days, {
                        locale,
                        minFraction: 0,
                        maxFraction: 1,
                      }),
                    })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('supplier.priceVariance')}</dt>
              <dd className="tabular-nums">{money(p.price_variance_total, locale, cur)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('supplier.returnRate')}</dt>
              <dd>
                <Badge tone={rateTone('lower_better', returns)}>{pctText(returns)}</Badge>
              </dd>
            </div>
          </dl>
        )}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {docList(t('supplier.recentOrders'), s.recent_orders, ORDERS_BASE, 'recent-orders')}
        {docList(t('supplier.recentInvoices'), s.recent_invoices, INVOICES_BASE, 'recent-invoices')}
      </div>
    </section>
  )
}
