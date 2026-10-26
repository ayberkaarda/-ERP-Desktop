import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { isApiError } from '@/platform'
import {
  CUSTOMER_SALES_VIEW,
  documentHref,
  formatAmount,
  isNegative,
  useCustomerSalesSummary,
  type CustomerSalesSummaryData,
  type SummaryLink,
} from '../lib/customer'

export type { CustomerSalesSummaryData } from '../lib/customer'

/**
 * Parties "Sales" tab: invoiced / credited totals, open balance, open orders and quotes, the risk
 * position and the latest orders and invoices (GET /customers/{id}/sales-summary).
 */
export function CustomerSalesSummary({ partyId }: { partyId: string }) {
  const { t } = useTranslation('sales-reports')
  const allowed = usePermission(CUSTOMER_SALES_VIEW)
  const canInvoices = usePermission('sales.invoices.view')
  const summary = useCustomerSalesSummary(partyId)

  if (!allowed) return <EmptyState description={t('summary.noAccess')} />
  if (summary.isError) {
    return (
      <div
        role="alert"
        className="space-y-2 rounded-lg border border-border bg-surface py-8 text-center text-sm"
      >
        <p className="font-medium">{t('summary.loadFailed')}</p>
        {isApiError(summary.error) && summary.error.message && (
          <p className="text-muted-foreground">{summary.error.message}</p>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => void summary.refetch()}>
          {t('summary.retry')}
        </Button>
      </div>
    )
  }
  if (!summary.data) return <Skeleton className="h-48 w-full" />

  return (
    <section aria-label={t('summary.title')} className="space-y-4">
      {canInvoices && (
        <div className="flex justify-end">
          <Link
            to={`/sales/invoices?filter%5Bparty_id%5D=${encodeURIComponent(partyId)}`}
            className="text-sm text-primary hover:underline"
          >
            {t('summary.allInvoices')}
          </Link>
        </div>
      )}
      <SummaryBody s={summary.data} />
    </section>
  )
}

function SummaryBody({ s }: { s: CustomerSalesSummaryData }) {
  const { t } = useTranslation('sales-reports')
  const locale = useIntlLocale()
  const cur = s.currency
  const e = s.exposure

  const tile = (label: string, value: string, testId?: string, danger = false) => (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          danger
            ? 'text-lg font-semibold text-danger tabular-nums'
            : 'text-lg font-semibold tabular-nums'
        }
        data-testid={testId}
      >
        {value}
      </p>
    </div>
  )

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile(
          t('summary.invoicedTotal'),
          formatAmount(s.invoices.invoiced_total, locale, cur),
          'summary-invoiced',
        )}
        {tile(t('summary.creditedTotal'), formatAmount(s.invoices.credited_total, locale, cur))}
        {tile(
          t('summary.openBalance'),
          formatAmount(s.invoices.balance_due, locale, cur),
          'summary-balance',
        )}
        {tile(t('summary.invoiceCount'), String(s.invoices.count))}
        {tile(
          t('summary.openOrders'),
          `${formatAmount(s.orders.open_value, locale, cur)} (${s.orders.open_count})`,
          'summary-open-orders',
        )}
        {tile(
          t('summary.openQuotes'),
          `${formatAmount(s.quotes.open_total, locale, cur)} (${s.quotes.open_count})`,
        )}
        {tile(
          t('summary.lastInvoice'),
          s.invoices.last_invoice_date ? formatDate(s.invoices.last_invoice_date, locale) : '—',
        )}
      </div>
      <dl
        className="grid gap-x-6 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-3"
        data-testid="summary-exposure"
      >
        <Fact label={t('summary.riskLimit')}>
          {e.limit === null ? t('summary.unlimited') : formatAmount(e.limit, locale, e.currency)}
        </Fact>
        <Fact label={t('summary.exposure')}>{formatAmount(e.total, locale, e.currency)}</Fact>
        <Fact label={t('summary.available')} danger={isNegative(e.available)}>
          {e.available === null ? '—' : formatAmount(e.available, locale, e.currency)}
        </Fact>
        <Fact label={t('summary.riskOpenInvoices')}>
          {formatAmount(e.open_invoices, locale, e.currency)}
        </Fact>
        <Fact label={t('summary.riskOpenOrders')}>
          {formatAmount(e.open_orders, locale, e.currency)}
        </Fact>
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <RecentTable title={t('summary.recentOrders')} rows={s.recent_orders} kind="order" />
        <RecentTable title={t('summary.recentInvoices')} rows={s.recent_invoices} kind="invoice" />
      </div>
    </>
  )
}

function Fact({
  label,
  danger = false,
  children,
}: {
  label: string
  danger?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={danger ? 'text-danger tabular-nums' : 'tabular-nums'}>{children}</dd>
    </div>
  )
}

function RecentTable({
  title,
  rows,
  kind,
}: {
  title: string
  rows: (SummaryLink & { balance_due?: string })[]
  kind: 'order' | 'invoice'
}) {
  const { t } = useTranslation(['sales-reports', 'sales-shared', 'sales-docs'])
  const locale = useIntlLocale()
  const status = (s: string) =>
    kind === 'order'
      ? t(`sales-shared:orderStatus.${s}` as 'sales-shared:orderStatus.draft', { defaultValue: s })
      : t(`sales-docs:invoiceStatus.${s}` as 'sales-docs:invoiceStatus.draft', { defaultValue: s })
  const th = 'h-row border-b border-border px-2 font-medium'
  const td = 'border-b border-border px-2 py-1'

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full border-separate border-spacing-0 text-table" aria-label={title}>
        <caption className="px-2 py-2 text-left text-sm font-semibold">{title}</caption>
        <thead className="bg-surface-sunken text-xs text-muted-foreground">
          <tr>
            <th className={`${th} text-left`}>{t('sales-reports:summary.colNumber')}</th>
            <th className={`${th} text-left`}>{t('sales-reports:summary.colDate')}</th>
            <th className={`${th} text-left`}>{t('sales-reports:summary.colStatus')}</th>
            <th className={`${th} text-right`}>{t('sales-reports:summary.colTotal')}</th>
            {kind === 'invoice' && (
              <th className={`${th} text-right`}>{t('sales-reports:summary.colBalance')}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className={`${td} text-muted-foreground`} colSpan={kind === 'invoice' ? 5 : 4}>
                {t('sales-reports:summary.none')}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <td className={`${td} font-code`}>
                  <Link to={documentHref(r)} className="text-primary hover:underline">
                    {r.number ?? t('sales-reports:summary.draft')}
                  </Link>
                </td>
                <td className={td}>{formatDate(r.document_date, locale)}</td>
                <td className={td}>{status(r.status)}</td>
                <td className={`${td} text-right tabular-nums`}>
                  {formatAmount(r.total, locale, r.currency_code)}
                </td>
                {kind === 'invoice' && (
                  <td className={`${td} text-right tabular-nums`}>
                    {formatAmount(r.balance_due, locale, r.currency_code)}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
