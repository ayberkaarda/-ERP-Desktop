import { createColumnHelper } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { DataTable, useUrlListQuery } from '@/components/shared/data-table'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { Can } from '@/lib/permissions'
import { SavedFiltersMenu } from '../components/SavedFiltersMenu'
import { usePriceListList } from '../hooks/queries'
import type { PriceList } from '../types'

const VIEW_KEY = 'catalog.priceLists'

export function PriceListListPage() {
  const { t } = useTranslation('catalog')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'code', desc: false }] },
    { viewKey: VIEW_KEY },
  )
  const list = usePriceListList(query)

  const columns = useMemo(() => {
    const col = createColumnHelper<PriceList>()
    const date = (v: string | null) => (v ? formatDate(v, locale) : '—')
    return [
      col.accessor('code', {
        header: t('fields.code'),
        enableSorting: true,
        meta: { label: t('fields.code') },
        cell: (c) => (
          <Link
            to={`/catalog/price-lists/${c.row.original.id}`}
            className="font-code hover:underline"
          >
            {c.getValue()}
          </Link>
        ),
        size: 130,
      }),
      col.accessor('name', {
        header: t('fields.name'),
        enableSorting: true,
        meta: { label: t('fields.name') },
        cell: (c) => (
          <span className="flex items-center gap-2">
            {c.getValue()}
            {c.row.original.is_default && <Badge tone="primary">{t('priceLists.default')}</Badge>}
          </span>
        ),
        size: 260,
      }),
      col.accessor('currency_code', {
        header: t('fields.currency'),
        enableSorting: true,
        meta: { label: t('fields.currency') },
        cell: (c) => <span className="font-code">{c.getValue()}</span>,
        size: 90,
      }),
      col.accessor('tax_inclusive', {
        header: t('fields.taxInclusive'),
        meta: {
          label: t('fields.taxInclusive'),
          filter: {
            options: [
              { value: 'true', label: t('priceLists.taxIncluded') },
              { value: 'false', label: t('priceLists.taxExcluded') },
            ],
          },
        },
        cell: (c) => (c.getValue() ? t('priceLists.taxIncluded') : t('priceLists.taxExcluded')),
        size: 130,
      }),
      col.accessor('valid_from', {
        header: t('fields.validFrom'),
        enableSorting: true,
        meta: { label: t('fields.validFrom') },
        cell: (c) => date(c.getValue()),
        size: 120,
      }),
      col.accessor('valid_to', {
        header: t('fields.validTo'),
        meta: { label: t('fields.validTo') },
        cell: (c) => date(c.getValue()),
        size: 120,
      }),
      col.accessor('is_active', {
        header: t('fields.status'),
        meta: {
          label: t('fields.status'),
          filter: {
            options: [
              { value: 'true', label: t('common.active') },
              { value: 'false', label: t('common.inactive') },
            ],
          },
        },
        cell: (c) => <StatusBadge status={c.getValue() ? 'active' : 'inactive'} />,
        size: 110,
      }),
    ]
  }, [t, locale])

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('priceLists.title')}
        description={t('priceLists.description')}
        breadcrumbs={[{ label: t('nav.catalog') }, { label: t('priceLists.title') }]}
        actions={
          <Can permission="price_lists.create">
            <Button asChild>
              <Link to="/catalog/price-lists/new">
                <Plus aria-hidden="true" />
                {t('priceLists.new')}
              </Link>
            </Button>
          </Can>
        }
      />
      <DataTable<PriceList>
        label={t('priceLists.title')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta.pagination.total ?? 0}
        loading={list.isPending}
        error={list.isError}
        onRetry={() => void list.refetch()}
        query={query}
        onQueryChange={setQuery}
        getRowId={(r) => r.id}
        viewKey={VIEW_KEY}
        onRowActivate={(r) => void navigate(`/catalog/price-lists/${r.id}`)}
        toolbar={
          <div className="ml-auto">
            <SavedFiltersMenu storageKey={VIEW_KEY} query={query} onQueryChange={setQuery} />
          </div>
        }
      />
    </div>
  )
}
