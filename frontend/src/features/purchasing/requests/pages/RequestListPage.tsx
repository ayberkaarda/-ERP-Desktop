import { createColumnHelper } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { DataTable, useUrlListQuery } from '@/components/shared/data-table'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { ExportButtons } from '@/features/sales/shared/components/ExportButtons'
import { exportParams } from '@/features/sales/shared/lib/download'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { Can, usePermission } from '@/lib/permissions'
import { requestsApi } from '../../shared/api'
import { PurchStatusBadge } from '../../shared/components/common'
import { ListFilters } from '../../shared/components/ListFilters'
import { useRequestList } from '../../shared/hooks/queries'
import { PURCH_PATHS } from '../../shared/lib/chain'
import { sanitizeListQuery } from '../../shared/lib/listFilters'
import { useScopedViewKey } from '../../shared/lib/savedViews'
import { PURCH_ACCESS } from '../../shared/permissions'
import { REQUEST_STATUSES, type RequestSummary } from '../../shared/types'

const BASE = PURCH_PATHS.request

/** Purchase requests with filters, saved views and CSV/XLSX export. */
export function RequestListPage() {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const viewKey = useScopedViewKey('requests')
  const items = usePermission('items.view')
  const parties = usePermission('parties.view')
  const { query: urlQuery, setQuery } = useUrlListQuery(
    { sort: [{ id: 'document_date', desc: true }] },
    { viewKey },
  )
  const query = sanitizeListQuery('request', urlQuery, { items, parties })
  const list = useRequestList(query)

  const columns = useMemo(() => {
    const col = createColumnHelper<RequestSummary>()
    return [
      col.accessor('number', {
        header: t('fields.number'),
        enableSorting: true,
        meta: { label: t('fields.number') },
        size: 160,
        cell: (c) => (
          <Link to={`${BASE}/${c.row.original.id}`} className="font-code hover:underline">
            {c.getValue() ?? t('common.unnumbered')}
          </Link>
        ),
      }),
      col.accessor('document_date', {
        header: t('fields.documentDate'),
        enableSorting: true,
        meta: { label: t('fields.documentDate') },
        size: 110,
        cell: (c) => formatDate(c.getValue(), locale),
      }),
      col.accessor('needed_by', {
        header: t('fields.neededBy'),
        enableSorting: true,
        meta: { label: t('fields.neededBy') },
        size: 120,
        cell: (c) => {
          const v = c.getValue()
          return v ? formatDate(v, locale) : '—'
        },
      }),
      col.accessor('line_count', {
        header: t('fields.lineCount'),
        meta: { label: t('fields.lineCount'), align: 'right' },
        size: 90,
        cell: (c) => c.getValue() ?? '—',
      }),
      col.accessor('status', {
        header: t('fields.status'),
        meta: {
          label: t('fields.status'),
          filter: {
            key: 'status',
            options: REQUEST_STATUSES.map((v) => ({ value: v, label: t(`status.request.${v}`) })),
          },
        },
        size: 150,
        cell: (c) => <PurchStatusBadge kind="request" status={c.getValue()} />,
      }),
      col.accessor('estimated_total', {
        header: t('fields.estimatedTotal'),
        enableSorting: true,
        meta: { label: t('fields.estimatedTotal'), align: 'right' },
        size: 150,
        cell: (c) => (
          <span className="tabular-nums">
            {formatMoney(c.getValue(), c.row.original.currency_code, locale)}
          </span>
        ),
      }),
    ]
  }, [t, locale])

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('requests.listTitle')}
        description={t('requests.listDescription')}
        breadcrumbs={[{ label: t('nav.purchasing') }, { label: t('requests.listTitle') }]}
        actions={
          <>
            <ExportButtons
              path={requestsApi.path}
              params={exportParams(query.q, query.filters)}
              filename={t('requests.exportName')}
            />
            <Can permission={PURCH_ACCESS.requestNew}>
              <Button asChild>
                <Link to={`${BASE}/new`}>
                  <Plus aria-hidden="true" />
                  {t('requests.new')}
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <ListFilters
        page="requests"
        query={urlQuery}
        setQuery={setQuery}
        supplierLabel={t('filters.suggestedSupplier')}
      />
      <DataTable<RequestSummary>
        label={t('requests.listTitle')}
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
