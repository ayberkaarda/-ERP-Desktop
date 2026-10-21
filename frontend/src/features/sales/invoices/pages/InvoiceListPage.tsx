import { createColumnHelper } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { DataTable } from '@/components/shared/data-table'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { formatDate, toIsoDate, useIntlLocale } from '@/lib/datetime'
import { Can } from '@/lib/permissions'
import { invoicesApi } from '../api'
import { ExportButtons } from '../../shared/components/ExportButtons'
import { ListFilters } from '../kit/components/ListFilters'
import { InvoiceStatusBadge } from '../kit/components/StatusBadges'
import { exportParams } from '../kit/http'
import { useListFilters } from '../kit/listFilters'
import { INVOICES_BASE } from '../kit/links'
import { dec, money } from '../kit/money'
import { SALES_PERMS } from '../kit/permissions'
import { useInvoiceList } from '../queries'
import { INVOICE_STATUSES, INVOICE_TYPES, POSTED_STATUSES, type InvoiceSummary } from '../types'

/** Invoices and credit notes with balances, filters, saved views and export. */
export function InvoiceListPage() {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const filters = useListFilters(
    'sales.invoices',
    { sort: [{ id: 'document_date', desc: true }] },
    ['invoice_type', 'open'],
  )
  const query = filters.query
  const list = useInvoiceList(query)
  const today = toIsoDate(new Date())
  const title = t('invoice.listTitle')

  const columns = useMemo(() => {
    const col = createColumnHelper<InvoiceSummary>()
    return [
      col.accessor('number', {
        header: t('fields.number'),
        enableSorting: true,
        meta: { label: t('fields.number') },
        size: 150,
        cell: (c) => (
          <Link to={`${INVOICES_BASE}/${c.row.original.id}`} className="font-code hover:underline">
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
      col.accessor('due_date', {
        header: t('fields.dueDate'),
        enableSorting: true,
        meta: { label: t('fields.dueDate') },
        size: 110,
        cell: (c) => {
          const v = c.getValue()
          const r = c.row.original
          const overdue =
            v !== null &&
            v < today &&
            POSTED_STATUSES.includes(r.status) &&
            dec(r.balance_due).greaterThan(0)
          return v ? (
            <span className={overdue ? 'font-medium text-danger' : undefined}>
              {formatDate(v, locale)}
              {overdue && <span className="sr-only"> {t('invoice.overdue')}</span>}
            </span>
          ) : (
            ''
          )
        },
      }),
      col.accessor('party_name', {
        header: t('fields.customer'),
        meta: { label: t('fields.customer') },
        size: 240,
        cell: (c) => c.getValue() ?? '',
      }),
      col.accessor('invoice_type', {
        header: t('fields.invoiceType'),
        meta: {
          label: t('fields.invoiceType'),
          filter: {
            key: 'invoice_type',
            options: INVOICE_TYPES.map((v) => ({ value: v, label: t(`invoiceType.${v}`) })),
          },
        },
        size: 110,
        cell: (c) => t(`invoiceType.${c.getValue()}`),
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
      col.accessor('balance_due', {
        header: t('fields.balanceDue'),
        // Not a server sort (document_date, number, party_name, total, status, due_date, ...).
        enableSorting: false,
        meta: { label: t('fields.balanceDue'), align: 'right' },
        size: 140,
        cell: (c) =>
          POSTED_STATUSES.includes(c.row.original.status) ? (
            <span className="tabular-nums">
              {money(c.getValue(), locale, c.row.original.currency_code)}
            </span>
          ) : (
            ''
          ),
      }),
      col.accessor('status', {
        header: t('fields.status'),
        meta: {
          label: t('fields.status'),
          filter: {
            key: 'status',
            options: INVOICE_STATUSES.map((v) => ({ value: v, label: t(`invoiceStatus.${v}`) })),
          },
        },
        size: 130,
        cell: (c) => <InvoiceStatusBadge status={c.getValue()} />,
      }),
    ]
  }, [t, locale, today])

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6">
      <PageHeader
        title={title}
        description={t('invoice.listDescription')}
        breadcrumbs={[{ label: t('nav.sales') }, { label: title }]}
        actions={
          <>
            <ExportButtons
              path={invoicesApi.path}
              params={exportParams(query)}
              filename="satis-faturalari"
            />
            <Can permission={SALES_PERMS.invoices.create}>
              <Button asChild>
                <Link to={`${INVOICES_BASE}/new`}>
                  <Plus aria-hidden="true" />
                  {t('invoice.new')}
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <ListFilters filters={filters}>
        <label className="flex h-control items-center gap-2 text-sm">
          <Checkbox
            checked={filters.f('open') === '1'}
            onChange={(e) => filters.change('open', e.target.checked ? '1' : '')}
          />
          {t('filters.openOnly')}
        </label>
      </ListFilters>
      <DataTable<InvoiceSummary>
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
        onRowActivate={(r) => void navigate(`${INVOICES_BASE}/${r.id}`)}
      />
    </div>
  )
}
