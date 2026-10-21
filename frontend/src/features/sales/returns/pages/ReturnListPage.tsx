import { createColumnHelper } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { DataTable } from '@/components/shared/data-table'
import { PageHeader } from '@/components/shared/PageHeader'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { ExportButtons } from '../../invoices/kit/components/ExportButtons'
import { ListFilters } from '../../invoices/kit/components/ListFilters'
import { ReturnStatusBadge } from '../../invoices/kit/components/StatusBadges'
import { exportParams } from '../../invoices/kit/http'
import { useListFilters } from '../../invoices/kit/listFilters'
import { RETURNS_BASE, linkTo } from '../../invoices/kit/links'
import { money } from '../../invoices/kit/money'
import { returnsApi } from '../api'
import { useReturnList } from '../queries'
import { RETURN_STATUSES, type ReturnSummary } from '../types'

/** Sales returns with filters, saved views and export (new returns start from an invoice). */
export function ReturnListPage() {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const filters = useListFilters('sales.returns', { sort: [{ id: 'document_date', desc: true }] })
  const list = useReturnList(filters.query)
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
        header: t('fields.customer'),
        meta: { label: t('fields.customer') },
        size: 240,
        cell: (c) => c.getValue() ?? '',
      }),
      col.accessor('invoice_id', {
        header: t('return.invoice'),
        meta: { label: t('return.invoice') },
        size: 110,
        cell: (c) => (
          <Link to={linkTo('sales_invoice', c.getValue())} className="text-primary hover:underline">
            {t('view.open')}
          </Link>
        ),
      }),
      col.accessor('total', {
        header: t('fields.total'),
        meta: { label: t('fields.total'), align: 'right' },
        size: 140,
        cell: (c) => (
          <span className="tabular-nums">
            {money(c.getValue(), locale, c.row.original.currency_code)}
          </span>
        ),
      }),
      col.accessor('credit_invoice_id', {
        header: t('return.creditNote'),
        meta: { label: t('return.creditNote') },
        size: 110,
        cell: (c) => {
          const id = c.getValue()
          return id ? (
            <Link to={linkTo('sales_invoice', id)} className="text-primary hover:underline">
              {t('view.open')}
            </Link>
          ) : (
            ''
          )
        },
      }),
      col.accessor('status', {
        header: t('fields.status'),
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
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={title}
        description={t('return.listDescription')}
        breadcrumbs={[{ label: t('nav.sales') }, { label: title }]}
        actions={
          <ExportButtons
            path={returnsApi.path}
            params={exportParams(filters.query)}
            filename="satis-iadeleri"
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
