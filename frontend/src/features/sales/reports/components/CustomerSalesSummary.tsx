import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateInput, FieldShell } from '@/components/shared/form'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, toIsoDate, useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { useCompanyStore } from '@/stores/company'
import { LoadError } from '../../invoices/kit/components/LoadError'
import { http, seg } from '../../invoices/kit/http'
import { salesDocsKeys } from '../../invoices/kit/keys'
import { INVOICES_BASE } from '../../invoices/kit/links'
import { dec, money, qty } from '../../invoices/kit/money'
import { SALES_OPEN, SALES_PERMS } from '../../invoices/kit/permissions'
import type { CustomerExposure, Envelope } from '../../invoices/kit/types'
import { ReportChart } from './ReportChart'

/** GET /customers/{id}/sales-summary?date_from&date_to (company currency). */
export interface CustomerSalesSummaryData {
  currency: string
  invoice_count: number
  net_sales: string
  returns: string
  gross_margin?: string | null
  open_balance: string
  overdue_balance: string
  open_orders_amount: string
  last_invoice_date: string | null
  monthly: { period: string; net_amount: string }[]
  top_items: {
    item_id: string
    item_code: string
    item_name: string
    quantity: string
    unit_code?: string | null
    net_amount: string
  }[]
}

const yearAgo = () => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 1)
  return toIsoDate(d)
}

/** Parties "Sales" tab: period KPIs, monthly sales, top items and the risk position. */
export function CustomerSalesSummary({ partyId }: { partyId: string }) {
  const { t } = useTranslation('sales-reports')
  const locale = useIntlLocale()
  useCompanyStore((s) => s.activeCompanyId)
  const allowed = usePermission(SALES_OPEN.customerSummary)
  const canInvoices = usePermission(SALES_PERMS.invoices.view)
  const [from, setFrom] = useState(yearAgo)
  const [to, setTo] = useState(() => toIsoDate(new Date()))
  const params = { date_from: from, date_to: to }
  const valid = Boolean(from && to && from <= to)
  const summary = useQuery({
    queryKey: salesDocsKeys.summary(partyId, params),
    queryFn: ({ signal }) =>
      http()
        .get<Envelope<CustomerSalesSummaryData>>(`/customers/${seg(partyId)}/sales-summary`, {
          params,
          signal,
        })
        .then((r) => r.data),
    enabled: allowed && valid && partyId !== '',
  })
  const exposure = useQuery({
    queryKey: salesDocsKeys.exposure(partyId),
    queryFn: ({ signal }) =>
      http()
        .get<Envelope<CustomerExposure>>(`/customers/${seg(partyId)}/exposure`, { signal })
        .then((r) => r.data),
    enabled: allowed && partyId !== '',
    staleTime: 15_000,
  })

  if (!allowed) return <EmptyState description={t('summary.noAccess')} />
  const s = summary.data
  const e = exposure.data
  const cur = s?.currency

  const tile = (label: string, value: string, testId?: string, tone?: 'danger') => (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          tone === 'danger'
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
    <section aria-label={t('summary.title')} className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <FieldShell label={t('param.dateFrom')} className="w-40">
          {(control) => (
            <DateInput {...control} value={from} max={to || undefined} onChange={setFrom} />
          )}
        </FieldShell>
        <FieldShell label={t('param.dateTo')} className="w-40">
          {(control) => (
            <DateInput {...control} value={to} min={from || undefined} onChange={setTo} />
          )}
        </FieldShell>
        {canInvoices && (
          <Link
            to={`${INVOICES_BASE}?filter%5Bparty_id%5D=${encodeURIComponent(partyId)}`}
            className="ml-auto text-sm text-primary hover:underline"
          >
            {t('summary.allInvoices')}
          </Link>
        )}
      </div>
      {summary.isError ? (
        <LoadError error={summary.error} onRetry={() => void summary.refetch()} />
      ) : !s ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {tile(t('summary.netSales'), money(s.net_sales, locale, cur), 'summary-net-sales')}
            {tile(t('summary.invoiceCount'), String(s.invoice_count))}
            {tile(t('summary.openBalance'), money(s.open_balance, locale, cur))}
            {tile(
              t('summary.overdue'),
              money(s.overdue_balance, locale, cur),
              undefined,
              dec(s.overdue_balance).greaterThan(0) ? 'danger' : undefined,
            )}
            {tile(t('summary.returns'), money(s.returns, locale, cur))}
            {tile(t('summary.openOrders'), money(s.open_orders_amount, locale, cur))}
            {s.gross_margin != null &&
              tile(t('summary.margin'), money(s.gross_margin, locale, cur))}
            {tile(
              t('summary.lastInvoice'),
              s.last_invoice_date ? formatDate(s.last_invoice_date, locale) : '—',
            )}
          </div>
          {s.monthly.length > 0 && (
            <ReportChart
              def={{ kind: 'column', label: 'period', values: ['net_amount'] }}
              rows={s.monthly}
              totals={null}
              title={t('summary.monthly')}
              labels={{ net_amount: 'netAmount' }}
            />
          )}
          {s.top_items.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table
                className="w-full border-separate border-spacing-0 text-table"
                aria-label={t('summary.topItems')}
              >
                <thead className="bg-surface-sunken text-xs text-muted-foreground">
                  <tr>
                    <th className="h-row border-b border-border px-2 text-left font-medium">
                      {t('col.code')}
                    </th>
                    <th className="h-row border-b border-border px-2 text-left font-medium">
                      {t('col.item')}
                    </th>
                    <th className="h-row border-b border-border px-2 text-right font-medium">
                      {t('col.quantity')}
                    </th>
                    <th className="h-row border-b border-border px-2 text-right font-medium">
                      {t('col.netAmount')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.top_items.map((i) => (
                    <tr key={i.item_id}>
                      <td className="border-b border-border px-2 py-1 font-code">{i.item_code}</td>
                      <td className="border-b border-border px-2 py-1">{i.item_name}</td>
                      <td className="border-b border-border px-2 py-1 text-right tabular-nums">
                        {qty(i.quantity, locale)} {i.unit_code ?? ''}
                      </td>
                      <td className="border-b border-border px-2 py-1 text-right tabular-nums">
                        {money(i.net_amount, locale, cur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {e && (
        <dl
          className="grid gap-x-6 gap-y-1 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-3"
          data-testid="summary-exposure"
        >
          <div>
            <dt className="text-xs text-muted-foreground">{t('summary.riskLimit')}</dt>
            <dd className="tabular-nums">
              {e.limit === null ? t('summary.unlimited') : money(e.limit, locale, e.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('summary.exposure')}</dt>
            <dd className="tabular-nums">{money(e.total, locale, e.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('summary.available')}</dt>
            <dd
              className={
                e.available !== null && dec(e.available).isNegative()
                  ? 'text-danger tabular-nums'
                  : 'tabular-nums'
              }
            >
              {e.available === null ? '—' : money(e.available, locale, e.currency)}
            </dd>
          </div>
        </dl>
      )}
    </section>
  )
}
