import { createColumnHelper } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { DataTable } from '@/components/shared/data-table'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { dec, money } from '@/features/sales/invoices/kit/money'
import { ExportButtons } from '@/features/sales/shared/components/ExportButtons'
import { formatDate, toIsoDate, useIntlLocale } from '@/lib/datetime'
import { Can } from '@/lib/permissions'
import { invoicesApi } from '../api'
import { useListFilters } from '@/features/sales/invoices/kit/listFilters'
import { ListFilters } from '../kit/components/ListFilters'
import { InvoiceStatusBadge, MatchStatusBadge } from '../kit/components/StatusBadges'
import { exportParams } from '../kit/http'
import { INVOICES_BASE } from '../kit/links'
import { PURCH_PERMS } from '../kit/permissions'
import { MATCH_STATUSES } from '../lib/match'
import { useInvoiceList } from '../queries'
import { BOOKED_STATUSES, INVOICE_STATUSES, INVOICE_TYPES, type InvoiceSummary } from '../types'

/** Supplier invoices and debit notes with balances, match state, filters, saved views, export. */
export function InvoiceListPage() {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const filters = useListFilters(
    'purchasing.invoices',
    { sort: [{ id: 'document_date', desc: true }] },
    ['invoice_type', 'match_status', 'open'],
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
      col.accessor('supplier_invoice_no', {
        header: t('fields.supplierInvoiceNo'),
        meta: { label: t('fields.supplierInvoiceNo') },
        size: 140,
        cell: (c) => <span className="font-code">{c.getValue() ?? ''}</span>,
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
            BOOKED_STATUSES.includes(r.status) &&
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
        header: t('fields.supplier'),
        enableSorting: true,
        meta: { label: t('fields.supplier') },
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
        size: 120,
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
        enableSorting: false,
        meta: { label: t('fields.balanceDue'), align: 'right' },
        size: 140,
        cell: (c) =>
          BOOKED_STATUSES.includes(c.row.original.status) ? (
            <span className="tabular-nums">
              {money(c.getValue(), locale, c.row.original.currency_code)}
            </span>
          ) : (
            ''
          ),
      }),
      col.accessor('match_status', {
        header: t('match.short'),
        meta: {
          label: t('match.short'),
          filter: {
            key: 'match_status',
            options: MATCH_STATUSES.map((v) => ({ value: v, label: t(`matchStatus.${v}`) })),
          },
        },
        size: 140,
        cell: (c) => {
          const v = c.getValue()
          return v && c.row.original.invoice_type === 'purchase' ? (
            <MatchStatusBadge status={v} />
          ) : (
            ''
          )
        },
      }),
      col.accessor('status', {
        header: t('fields.status'),
        enableSorting: true,
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
        breadcrumbs={[{ label: t('nav.purchasing') }, { label: title }]}
        actions={
          <>
            <ExportButtons
              path={invoicesApi.path}
              params={exportParams(query)}
              filename="alis-faturalari"
            />
            <Can permission={PURCH_PERMS.invoices.create}>
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
