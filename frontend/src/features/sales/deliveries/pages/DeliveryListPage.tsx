import { createColumnHelper } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { DataTable, type ListQueryState } from '@/components/shared/data-table'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { Can } from '@/lib/permissions'
import { ExportButtons } from '../../invoices/kit/components/ExportButtons'
import { ListFilters } from '../../invoices/kit/components/ListFilters'
import { useListFilters } from '../../invoices/kit/listFilters'
import { DeliveryStatusBadge } from '../../invoices/kit/components/StatusBadges'
import { exportParams } from '../../invoices/kit/http'
import { DELIVERIES_BASE } from '../../invoices/kit/links'
import { SALES_PERMS } from '../../invoices/kit/permissions'
import { deliveriesApi } from '../api'
import { useDeliveryList } from '../queries'
import { DELIVERY_STATUSES, type DeliverySummary } from '../types'

/** Dispatch notes with filters, saved views, export and direct delivery creation. */
export function DeliveryListPage() {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const filters = useListFilters('sales.deliveries', {
    sort: [{ id: 'document_date', desc: true }],
  })
  const query: ListQueryState = filters.query
  const list = useDeliveryList(query)
  const title = t('delivery.listTitle')

  const columns = useMemo(() => {
    const col = createColumnHelper<DeliverySummary>()
    return [
      col.accessor('number', {
        header: t('fields.number'),
        enableSorting: true,
        meta: { label: t('fields.number') },
        size: 150,
        cell: (c) => (
          <Link
            to={`${DELIVERIES_BASE}/${c.row.original.id}`}
            className="font-code hover:underline"
          >
            {c.getValue() ?? t('links.unnumbered')}
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
        header: t('fields.customer'),
        meta: { label: t('fields.customer') },
        size: 260,
        cell: (c) => c.getValue() ?? '',
      }),
      col.accessor('order_number', {
        header: t('delivery.order'),
        meta: { label: t('delivery.order') },
        size: 140,
        cell: (c) => <span className="font-code">{c.getValue() ?? t('delivery.direct')}</span>,
      }),
      col.accessor('line_count', {
        header: t('fields.lineCount'),
        meta: { label: t('fields.lineCount'), align: 'right' },
        size: 80,
        cell: (c) => <span className="tabular-nums">{c.getValue() ?? ''}</span>,
      }),
      col.accessor('invoiced_state', {
        header: t('fields.invoicedState'),
        meta: { label: t('fields.invoicedState') },
        size: 130,
        cell: (c) => {
          const v = c.getValue()
          return v ? t(`invoicedState.${v}`) : ''
        },
      }),
      col.accessor('status', {
        header: t('fields.status'),
        meta: {
          label: t('fields.status'),
          filter: {
            key: 'status',
            options: DELIVERY_STATUSES.map((v) => ({ value: v, label: t(`deliveryStatus.${v}`) })),
          },
        },
        size: 120,
        cell: (c) => <DeliveryStatusBadge status={c.getValue()} />,
      }),
    ]
  }, [t, locale])

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={title}
        description={t('delivery.listDescription')}
        breadcrumbs={[{ label: t('nav.sales') }, { label: title }]}
        actions={
          <>
            <ExportButtons
              path={deliveriesApi.path}
              params={exportParams(query)}
              filename="sevk-irsaliyeleri"
            />
            <Can permission={SALES_PERMS.deliveries.create}>
              <Button asChild>
                <Link to={`${DELIVERIES_BASE}/new`}>
                  <Plus aria-hidden="true" />
                  {t('delivery.newDirect')}
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <ListFilters filters={filters} />
      <DataTable<DeliverySummary>
        label={title}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta.pagination.total ?? 0}
        loading={list.isPending}
        error={list.isError}
        onRetry={() => void list.refetch()}
        query={filters.urlQuery}
        onQueryChange={filters.setQuery}
        getRowId={(r) => r.id}
        viewKey={filters.viewKey}
        enableColumnResizing
        onRowActivate={(r) => void navigate(`${DELIVERIES_BASE}/${r.id}`)}
      />
    </div>
  )
}
