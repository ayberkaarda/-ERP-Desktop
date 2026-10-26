import { createColumnHelper } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { DataTable, useUrlListQuery } from '@/components/shared/data-table'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { Can, usePermission } from '@/lib/permissions'
import { quotesApi } from '../../shared/api'
import { SalesStatusBadge } from '../../shared/components/common'
import { ExportButtons } from '../../shared/components/ExportButtons'
import { ListFilters } from '../../shared/components/ListFilters'
import { sanitizeListQuery } from '../../shared/lib/listFilters'
import { useQuoteList } from '../../shared/hooks/queries'
import { exportParams } from '../../shared/lib/download'
import { SALES_PATHS } from '../../shared/lib/insights'
import { useScopedViewKey } from '../../shared/lib/savedViews'
import { SALES_ACCESS } from '../../shared/permissions'
import { QUOTE_STATUSES, type SalesQuoteSummary } from '../../shared/types'

const BASE = SALES_PATHS.quote

/** Quotes with filters, saved views (per user and company) and CSV/XLSX export. */
export function QuoteListPage() {
  const { t } = useTranslation('sales-quotes')
  const { t: ts } = useTranslation('sales-shared')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const viewKey = useScopedViewKey('quotes')
  const canPickItems = usePermission('items.view')
  const { query: urlQuery, setQuery } = useUrlListQuery(
    { sort: [{ id: 'document_date', desc: true }] },
    { viewKey },
  )
  const query = sanitizeListQuery(urlQuery, canPickItems)
  const list = useQuoteList(query)

  const columns = useMemo(() => {
    const col = createColumnHelper<SalesQuoteSummary>()
    return [
      col.accessor('number', {
        header: ts('fields.number'),
        enableSorting: true,
        meta: { label: ts('fields.number') },
        size: 150,
        cell: (c) => (
          <Link to={`${BASE}/${c.row.original.id}`} className="font-code hover:underline">
            {c.getValue() ?? ts('editor.unnumbered')}
          </Link>
        ),
      }),
      col.accessor('document_date', {
        header: ts('fields.documentDate'),
        enableSorting: true,
        meta: { label: ts('fields.documentDate') },
        size: 110,
        cell: (c) => formatDate(c.getValue(), locale),
      }),
      col.accessor('party_name', {
        header: ts('fields.party'),
        enableSorting: true,
        meta: { label: ts('fields.party') },
        size: 260,
      }),
      col.accessor('valid_until', {
        header: ts('fields.validUntil'),
        meta: { label: ts('fields.validUntil') },
        size: 110,
        cell: (c) => {
          const v = c.getValue()
          return v ? formatDate(v, locale) : '—'
        },
      }),
      col.accessor('revision', {
        header: ts('fields.revision'),
        meta: { label: ts('fields.revision'), align: 'right' },
        size: 80,
        cell: (c) => <span className="tabular-nums">{c.getValue()}</span>,
      }),
      col.accessor('status', {
        header: ts('fields.status'),
        meta: {
          label: ts('fields.status'),
          filter: {
            key: 'status',
            options: QUOTE_STATUSES.map((v) => ({ value: v, label: ts(`quoteStatus.${v}`) })),
          },
        },
        size: 130,
        cell: (c) => <SalesStatusBadge kind="quote" status={c.getValue()} />,
      }),
      col.accessor('total', {
        header: ts('fields.total'),
        enableSorting: true,
        meta: { label: ts('fields.total'), align: 'right' },
        size: 150,
        cell: (c) => (
          <span className="tabular-nums">
            {formatMoney(c.getValue(), c.row.original.currency_code, locale)}
          </span>
        ),
      }),
    ]
  }, [ts, locale])

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        breadcrumbs={[{ label: ts('nav.sales') }, { label: t('list.title') }]}
        actions={
          <>
            <ExportButtons
              path={quotesApi.path}
              params={exportParams(query.q, query.filters)}
              filename={t('list.exportName')}
            />
            <Can permission={SALES_ACCESS.quoteNew}>
              <Button asChild>
                <Link to={`${BASE}/new`}>
                  <Plus aria-hidden="true" />
                  {t('list.new')}
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <ListFilters page="quotes" query={urlQuery} setQuery={setQuery} />
      <DataTable<SalesQuoteSummary>
        label={t('list.title')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta.pagination.total ?? 0}
        loading={list.isPending}
        error={list.isError}
        onRetry={() => void list.refetch()}
        query={urlQuery}
        onQueryChange={setQuery}
        getRowId={(r) => r.id}
        viewKey={viewKey}
        enableColumnResizing
        onRowActivate={(r) => void navigate(`${BASE}/${r.id}`)}
      />
    </div>
  )
}
