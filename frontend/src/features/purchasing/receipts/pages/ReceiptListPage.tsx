import { createColumnHelper } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { DataTable } from '@/components/shared/data-table'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { money } from '@/features/sales/invoices/kit/money'
import { useCompanyCurrency } from '@/features/sales/invoices/kit/viewKey'
import { ExportButtons } from '@/features/sales/shared/components/ExportButtons'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { Can } from '@/lib/permissions'
import { useListFilters } from '@/features/sales/invoices/kit/listFilters'
import { ListFilters } from '../../invoices/kit/components/ListFilters'
import { ReceiptStatusBadge } from '../../invoices/kit/components/StatusBadges'
import { exportParams } from '../../invoices/kit/http'
import { RECEIPTS_BASE } from '../../invoices/kit/links'
import { PURCH_PERMS } from '../../invoices/kit/permissions'
import { receiptsApi } from '../api'
import { useReceiptList } from '../queries'
import { RECEIPT_STATUSES, type ReceiptSummary } from '../types'

/** Goods receipts with filters, saved views and export. */
export function ReceiptListPage() {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const companyCurrency = useCompanyCurrency()
  const filters = useListFilters('purchasing.receipts', {
    sort: [{ id: 'document_date', desc: true }],
  })
  const query = filters.query
  const list = useReceiptList(query)
  const title = t('receipt.listTitle')

  const columns = useMemo(() => {
    const col = createColumnHelper<ReceiptSummary>()
    return [
      col.accessor('number', {
        header: t('fields.number'),
        enableSorting: true,
        meta: { label: t('fields.number') },
        size: 150,
        cell: (c) => (
          <Link to={`${RECEIPTS_BASE}/${c.row.original.id}`} className="font-code hover:underline">
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
      col.accessor('supplier_reference', {
        header: t('fields.supplierReference'),
        meta: { label: t('fields.supplierReference') },
        size: 150,
        cell: (c) => <span className="font-code">{c.getValue() ?? ''}</span>,
      }),
      col.accessor('order_id', {
        header: t('receipt.source'),
        meta: { label: t('receipt.source') },
        size: 120,
        cell: (c) =>
          c.row.original.invoice_id
            ? t('receipt.sourceInvoice')
            : c.getValue()
              ? t('receipt.sourceOrder')
              : t('receipt.sourceDirect'),
      }),
      col.accessor('line_count', {
        header: t('fields.lineCount'),
        meta: { label: t('fields.lineCount'), align: 'right' },
        size: 90,
        cell: (c) => <span className="tabular-nums">{c.getValue() ?? ''}</span>,
      }),
      col.accessor('cost_total', {
        header: t('fields.costTotal'),
        meta: { label: t('fields.costTotal'), align: 'right' },
        size: 140,
        cell: (c) =>
          c.row.original.status === 'posted' ? (
            <span className="tabular-nums">{money(c.getValue(), locale, companyCurrency)}</span>
          ) : (
            ''
          ),
      }),
      col.accessor('status', {
        header: t('fields.status'),
        enableSorting: true,
        meta: {
          label: t('fields.status'),
          filter: {
            key: 'status',
            options: RECEIPT_STATUSES.map((v) => ({ value: v, label: t(`receiptStatus.${v}`) })),
          },
        },
        size: 120,
        cell: (c) => <ReceiptStatusBadge status={c.getValue()} />,
      }),
    ]
  }, [t, locale, companyCurrency])

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6">
      <PageHeader
        title={title}
        description={t('receipt.listDescription')}
        breadcrumbs={[{ label: t('nav.purchasing') }, { label: title }]}
        actions={
          <>
            <ExportButtons
              path={receiptsApi.path}
              params={exportParams(query)}
              filename="mal-kabulleri"
            />
            <Can permission={PURCH_PERMS.receipts.create}>
              <Button asChild variant="secondary">
                <Link to={`${RECEIPTS_BASE}/new`}>
                  <Plus aria-hidden="true" />
                  {t('receipt.newDirect')}
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <ListFilters filters={filters} />
      <DataTable<ReceiptSummary>
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
        onRowActivate={(r) => void navigate(`${RECEIPTS_BASE}/${r.id}`)}
      />
    </div>
  )
}
