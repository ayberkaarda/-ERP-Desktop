import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createColumnHelper } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { DataTable } from '@/components/shared/data-table'
import { PageHeader } from '@/components/shared/PageHeader'
import { money } from '@/features/sales/invoices/kit/money'
import { ExportButtons } from '@/features/sales/shared/components/ExportButtons'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { useCompanyStore } from '@/stores/company'
import { useListFilters } from '@/features/sales/invoices/kit/listFilters'
import { ListFilters } from '../../invoices/kit/components/ListFilters'
import { ReturnStatusBadge } from '../../invoices/kit/components/StatusBadges'
import { exportParams } from '../../invoices/kit/http'
import { purchKeys } from '../../invoices/kit/keys'
import { RETURNS_BASE } from '../../invoices/kit/links'
import { returnsApi } from '../api'
import { RETURN_STATUSES, type ReturnSummary } from '../types'

/** Purchase returns with filters, saved views and export (created from invoices or receipts). */
export function ReturnListPage() {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  useCompanyStore((s) => s.activeCompanyId)
  const filters = useListFilters('purchasing.returns', {
    sort: [{ id: 'document_date', desc: true }],
  })
  const query = filters.query
  const list = useQuery({
    queryKey: purchKeys.list('returns', query),
    queryFn: ({ signal }) => returnsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
  const title = t('return.listTitle')

  const columns = useMemo(() => {
    const col = createColumnHelper<ReturnSummary>()
    return [
      col.accessor('number', {
        header: t('fields.number'),
        enableSorting: true,
        meta: { label: t('fields.number') },
        size: 150,
        cell: (c) => (
          <Link to={`${RETURNS_BASE}/${c.row.original.id}`} className="font-code hover:underline">
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
        header: t('fields.supplier'),
        enableSorting: true,
        meta: { label: t('fields.supplier') },
        size: 240,
        cell: (c) => c.getValue() ?? '',
      }),
      col.accessor('invoice_id', {
        header: t('return.source'),
        meta: { label: t('return.source') },
        size: 120,
        cell: (c) => (c.getValue() ? t('return.sourceInvoice') : t('return.sourceReceipt')),
      }),
      col.accessor('reason', {
        header: t('fields.reason'),
        meta: { label: t('fields.reason') },
        size: 220,
        cell: (c) => c.getValue() ?? '',
      }),
      col.accessor('total', {
        header: t('fields.total'),
        enableSorting: true,
        meta: { label: t('fields.total'), align: 'right' },
        size: 140,
        cell: (c) => (
          <span className="tabular-nums">
            {money(c.getValue(), locale, c.row.original.currency_code)}
          </span>
        ),
      }),
      col.accessor('status', {
        header: t('fields.status'),
        enableSorting: true,
        meta: {
          label: t('fields.status'),
          filter: {
            key: 'status',
            options: RETURN_STATUSES.map((v) => ({ value: v, label: t(`returnStatus.${v}`) })),
          },
        },
        size: 120,
        cell: (c) => <ReturnStatusBadge status={c.getValue()} />,
      }),
    ]
  }, [t, locale])

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6">
      <PageHeader
        title={title}
        description={t('return.listDescription')}
        breadcrumbs={[{ label: t('nav.purchasing') }, { label: title }]}
        actions={
          <ExportButtons
            path={returnsApi.path}
            params={exportParams(query)}
            filename="alis-iadeleri"
          />
        }
      />
      <ListFilters filters={filters} />
      <DataTable<ReturnSummary>
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
        onRowActivate={(r) => void navigate(`${RETURNS_BASE}/${r.id}`)}
      />
    </div>
  )
}
