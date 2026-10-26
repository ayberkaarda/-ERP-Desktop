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
import { ordersApi } from '../../shared/api'
import { PurchStatusBadge } from '../../shared/components/common'
import { ListFilters } from '../../shared/components/ListFilters'
import { useOrderList } from '../../shared/hooks/queries'
import { PURCH_PATHS } from '../../shared/lib/chain'
import { sanitizeListQuery } from '../../shared/lib/listFilters'
import { useScopedViewKey } from '../../shared/lib/savedViews'
import { PURCH_ACCESS } from '../../shared/permissions'
import { ORDER_STATUSES, type OrderSummary } from '../../shared/types'

const BASE = PURCH_PATHS.order

/** Purchase orders with filters, saved views (per user and company) and CSV/XLSX export. */
export function OrderListPage() {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const viewKey = useScopedViewKey('orders')
  const items = usePermission('items.view')
  const parties = usePermission('parties.view')
  const { query: urlQuery, setQuery } = useUrlListQuery(
    { sort: [{ id: 'document_date', desc: true }] },
    { viewKey },
  )
  const query = sanitizeListQuery('order', urlQuery, { items, parties })
  const list = useOrderList(query)

  const columns = useMemo(() => {
    const col = createColumnHelper<OrderSummary>()
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
      col.accessor('party_name', {
        header: t('fields.supplier'),
        enableSorting: true,
        meta: { label: t('fields.supplier') },
        size: 260,
      }),
      col.accessor('expected_date', {
        header: t('fields.expectedDate'),
        meta: { label: t('fields.expectedDate') },
        size: 120,
        cell: (c) => {
          const v = c.getValue()
          return v ? formatDate(v, locale) : '—'
        },
      }),
      col.accessor('status', {
        header: t('fields.status'),
        meta: {
          label: t('fields.status'),
          filter: {
            key: 'status',
            options: ORDER_STATUSES.map((v) => ({ value: v, label: t(`status.order.${v}`) })),
          },
        },
        size: 150,
        cell: (c) => <PurchStatusBadge kind="order" status={c.getValue()} />,
      }),
      col.accessor('total', {
        header: t('fields.total'),
        enableSorting: true,
        meta: { label: t('fields.total'), align: 'right' },
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
        title={t('orders.listTitle')}
        description={t('orders.listDescription')}
        breadcrumbs={[{ label: t('nav.purchasing') }, { label: t('orders.listTitle') }]}
        actions={
          <>
            <ExportButtons
              path={ordersApi.path}
              params={exportParams(query.q, query.filters)}
              filename={t('orders.exportName')}
            />
            <Can permission={PURCH_ACCESS.orderNew}>
              <Button asChild>
                <Link to={`${BASE}/new`}>
                  <Plus aria-hidden="true" />
                  {t('orders.new')}
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <ListFilters page="orders" query={urlQuery} setQuery={setQuery} />
      <DataTable<OrderSummary>
        label={t('orders.listTitle')}
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
