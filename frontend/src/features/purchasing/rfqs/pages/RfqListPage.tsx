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
import { Can, usePermission } from '@/lib/permissions'
import { rfqsApi } from '../../shared/api'
import { PurchStatusBadge } from '../../shared/components/common'
import { ListFilters } from '../../shared/components/ListFilters'
import { useRfqList } from '../../shared/hooks/queries'
import { PURCH_PATHS } from '../../shared/lib/chain'
import { sanitizeListQuery } from '../../shared/lib/listFilters'
import { useScopedViewKey } from '../../shared/lib/savedViews'
import { PURCH_ACCESS } from '../../shared/permissions'
import { RFQ_STATUSES, type RfqSummary } from '../../shared/types'

const BASE = PURCH_PATHS.rfq

/** Requests for quotation with filters, saved views and CSV/XLSX export. */
export function RfqListPage() {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const viewKey = useScopedViewKey('rfqs')
  const items = usePermission('items.view')
  const parties = usePermission('parties.view')
  const { query: urlQuery, setQuery } = useUrlListQuery(
    { sort: [{ id: 'document_date', desc: true }] },
    { viewKey },
  )
  const query = sanitizeListQuery('rfq', urlQuery, { items, parties })
  const list = useRfqList(query)

  const columns = useMemo(() => {
    const col = createColumnHelper<RfqSummary>()
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
      col.accessor('response_due', {
        header: t('fields.responseDue'),
        enableSorting: true,
        meta: { label: t('fields.responseDue') },
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
            options: RFQ_STATUSES.map((v) => ({ value: v, label: t(`status.rfq.${v}`) })),
          },
        },
        size: 150,
        cell: (c) => <PurchStatusBadge kind="rfq" status={c.getValue()} />,
      }),
      col.accessor('currency_code', {
        header: t('fields.currency'),
        meta: { label: t('fields.currency') },
        size: 90,
      }),
    ]
  }, [t, locale])

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('rfqs.listTitle')}
        description={t('rfqs.listDescription')}
        breadcrumbs={[{ label: t('nav.purchasing') }, { label: t('rfqs.listTitle') }]}
        actions={
          <>
            <ExportButtons
              path={rfqsApi.path}
              params={exportParams(query.q, query.filters)}
              filename={t('rfqs.exportName')}
            />
            <Can permission={PURCH_ACCESS.rfqNew}>
              <Button asChild>
                <Link to={`${BASE}/new`}>
                  <Plus aria-hidden="true" />
                  {t('rfqs.new')}
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <ListFilters
        page="rfqs"
        query={urlQuery}
        setQuery={setQuery}
        supplierLabel={t('filters.invitedSupplier')}
      />
      <DataTable<RfqSummary>
        label={t('rfqs.listTitle')}
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
