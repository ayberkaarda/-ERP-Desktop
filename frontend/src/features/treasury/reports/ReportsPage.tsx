import { scalar } from '../shared/format'
import { REPORTS } from './definitions'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/permissions'
import { ExportButtons } from '@/features/sales/shared/components/ExportButtons'
import { toIsoDate } from '@/lib/datetime'
import { treasuryApi } from '../shared/api'
import { treasuryKey } from '../shared/keys'
import {
  AccountField,
  DateField,
  ErrorNotice,
  Loading,
  Panel,
  PartyField,
  TextField,
  TreasuryHeader,
} from '../shared/ui'
import { useAccounts, useTreasuryCompany, useTreasuryT } from '../shared/hooks'
export function ReportsHub() {
  const t = useTreasuryT()
  const canSales = usePermission('sales.invoices.view')
  const canPurchases = usePermission('purchasing.invoices.view')
  return (
    <>
      <TreasuryHeader area="reports" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.filter((slug) =>
          slug === 'receivables-ageing'
            ? canSales
            : slug === 'payables-ageing'
              ? canPurchases
              : true,
        ).map((slug) => (
          <Link
            key={slug}
            to={`/treasury/reports/${slug}`}
            className="rounded-lg border border-border bg-surface p-5 transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
          >
            <h2 className="font-semibold">{t(slug)}</h2>
          </Link>
        ))}
      </div>
    </>
  )
}
export function ReportsPage() {
  const { slug = 'cash-flow' } = useParams()
  const company = useTreasuryCompany()
  return <ReportContent key={`${company}:${slug}`} slug={slug} />
}
function ReportContent({ slug }: { slug: string }) {
  const t = useTreasuryT()
  const company = useTreasuryCompany()
  const accounts = useAccounts()
  const allowed = usePermission(
    slug === 'receivables-ageing'
      ? ['treasury.reports.view', 'sales.invoices.view']
      : slug === 'payables-ageing'
        ? ['treasury.reports.view', 'purchasing.invoices.view']
        : 'treasury.reports.view',
  )
  const today = toIsoDate(new Date())
  const [draft, setDraft] = useState({
    date_from: `${today.slice(0, 4)}-01-01`,
    date_to: today,
    as_of: today,
    account_id: '',
    party_id: '',
    currency_code: '',
  })
  const [filters, setFilters] = useState(draft)
  const [page, setPage] = useState(1)
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => Boolean(v)))
  const query = useQuery({
    queryKey: treasuryKey(company, 'reports', slug, params, page),
    queryFn: ({ signal }) => treasuryApi.report(slug, { ...params, page, per_page: 100 }, signal),
    placeholderData: keepPreviousData,
    enabled: allowed && (REPORTS as readonly string[]).includes(slug),
  })
  const rows = query.data?.data ?? []
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).filter((key) =>
    rows.some((row) => typeof row[key] !== 'object' || row[key] === null),
  )
  const pagination = query.data?.meta?.pagination as
    { current_page: number; last_page: number; total: number } | undefined
  const set = (key: keyof typeof draft, value: string) =>
    setDraft((old) => ({ ...old, [key]: value }))
  if (!allowed)
    return (
      <Panel>
        <p>{t('noAccess')}</p>
      </Panel>
    )
  if (!(REPORTS as readonly string[]).includes(slug))
    return (
      <Panel>
        <p>{t('empty')}</p>
      </Panel>
    )
  return (
    <div className="space-y-4">
      <TreasuryHeader area="reports" title={t(slug)}>
        <ExportButtons
          path={`/treasury-reports/${slug}`}
          params={params}
          filename={`treasury-${slug}`}
        />
      </TreasuryHeader>
      <Panel>
        <form
          className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault()
            setFilters(draft)
            setPage(1)
          }}
        >
          <DateField
            name="date_from"
            value={draft.date_from}
            onChange={(v) => set('date_from', v)}
          />
          <DateField name="date_to" value={draft.date_to} onChange={(v) => set('date_to', v)} />
          <DateField name="as_of" value={draft.as_of} onChange={(v) => set('as_of', v)} />
          <AccountField
            value={draft.account_id}
            onChange={(v) => set('account_id', v)}
            accounts={accounts.data?.data ?? []}
            required={false}
          />
          <PartyField value={draft.party_id} onChange={(v) => set('party_id', v)} />
          <TextField
            name="currency_code"
            value={draft.currency_code}
            onChange={(v) => set('currency_code', v.toUpperCase())}
          />
          <Button type="submit" disabled={query.isFetching}>
            {t('run')}
          </Button>
        </form>
      </Panel>
      <ErrorNotice error={query.error ?? accounts.error} reload={() => void query.refetch()} />
      {query.isPending ? (
        <Loading />
      ) : (
        <Panel>
          {typeof query.data?.meta?.currency === 'string' && (
            <p className="mb-3 text-sm text-muted-foreground">
              {t('currency_code')}: {query.data.meta.currency}
            </p>
          )}
          {rows.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">{t('empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-y border-border bg-surface-sunken">
                    {columns.map((key) => (
                      <th key={key} className="whitespace-nowrap p-2">
                        {t(key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={scalar(row.id ?? `${page}-${i}`)} className="border-b border-border">
                      {columns.map((key) => (
                        <td key={key} className="whitespace-nowrap p-2 tabular-nums">
                          {row[key] === null || row[key] === undefined
                            ? '—'
                            : typeof row[key] === 'boolean'
                              ? scalar(row[key])
                              : scalar(row[key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pagination && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span>
                {t('page', { page: pagination.current_page, total: pagination.last_page })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={page <= 1 || query.isFetching}
                  onClick={() => setPage(page - 1)}
                >
                  {t('previous')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={page >= pagination.last_page || query.isFetching}
                  onClick={() => setPage(page + 1)}
                >
                  {t('next')}
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}
