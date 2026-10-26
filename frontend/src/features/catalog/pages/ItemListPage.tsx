import { createColumnHelper } from '@tanstack/react-table'
import { Plus, ScanBarcode } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { DataTable, useUrlListQuery } from '@/components/shared/data-table'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Can } from '@/lib/permissions'
import { SavedFiltersMenu } from '../components/SavedFiltersMenu'
import { useCategories, useItemList, useUnits } from '../hooks/queries'
import { detectBarcodeType } from '../lib/barcode'
import { buildTree, flattenTree } from '../lib/tree'
import { ITEM_TYPES, TRACKING_MODES, type Item } from '../types'

const VIEW_KEY = 'catalog.items'

export function ItemListPage() {
  const { t } = useTranslation('catalog')
  const navigate = useNavigate()
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'code', desc: false }] },
    { viewKey: VIEW_KEY },
  )
  const list = useItemList(query)
  const categories = useCategories()
  const units = useUnits()

  const categoryOptions = useMemo(
    () =>
      flattenTree(buildTree(categories.data ?? [])).map((n) => ({
        value: n.category.id,
        label: `${'  '.repeat(n.depth)}${n.category.name}`,
      })),
    [categories.data],
  )
  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  )
  const unitCode = useMemo(
    () => new Map((units.data ?? []).map((u) => [u.id, u.code])),
    [units.data],
  )

  const columns = useMemo(() => {
    const col = createColumnHelper<Item>()
    return [
      col.accessor('code', {
        header: t('fields.code'),
        enableSorting: true,
        meta: { label: t('fields.code') },
        cell: (c) => (
          <Link to={`/catalog/items/${c.row.original.id}`} className="font-code hover:underline">
            {c.getValue()}
          </Link>
        ),
        size: 130,
      }),
      col.accessor('name', {
        header: t('fields.name'),
        enableSorting: true,
        meta: { label: t('fields.name') },
        size: 280,
      }),
      col.accessor('type', {
        header: t('fields.type'),
        meta: {
          label: t('fields.type'),
          filter: { options: ITEM_TYPES.map((v) => ({ value: v, label: t(`itemType.${v}`) })) },
        },
        cell: (c) => t(`itemType.${c.getValue()}`),
        size: 110,
      }),
      col.accessor('category_id', {
        header: t('fields.category'),
        meta: {
          label: t('fields.category'),
          // The API filters by `category` (the category and its whole subtree).
          filter: { key: 'category', options: categoryOptions },
        },
        cell: (c) => {
          const id = c.getValue()
          return id ? (c.row.original.category?.name ?? categoryName.get(id) ?? '—') : '—'
        },
        size: 180,
      }),
      col.accessor('base_unit_id', {
        header: t('fields.baseUnit'),
        meta: { label: t('fields.baseUnit') },
        cell: (c) => (
          <span className="font-code">
            {c.row.original.base_unit?.code ?? unitCode.get(c.getValue()) ?? '—'}
          </span>
        ),
        size: 100,
      }),
      col.accessor('tracking', {
        header: t('fields.tracking'),
        meta: {
          label: t('fields.tracking'),
          filter: { options: TRACKING_MODES.map((v) => ({ value: v, label: t(`tracking.${v}`) })) },
        },
        cell: (c) => t(`tracking.${c.getValue()}`),
        size: 120,
      }),
      col.accessor('is_active', {
        header: t('fields.status'),
        meta: {
          label: t('fields.status'),
          filter: {
            key: 'is_active',
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
  }, [t, categoryOptions, categoryName, unitCode])

  const barcodeHint =
    query.q.trim() !== '' && detectBarcodeType(query.q) !== 'other' ? (
      <p role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
        <ScanBarcode className="size-3.5" aria-hidden="true" />
        {t('items.barcodeSearch')}
      </p>
    ) : null

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('items.title')}
        description={t('items.description')}
        breadcrumbs={[{ label: t('nav.catalog') }, { label: t('items.title') }]}
        actions={
          <Can permission="items.create">
            <Button asChild>
              <Link to="/catalog/items/new">
                <Plus aria-hidden="true" />
                {t('items.new')}
              </Link>
            </Button>
          </Can>
        }
      />
      <DataTable<Item>
        label={t('items.title')}
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
        enableColumnResizing
        onRowActivate={(r) => void navigate(`/catalog/items/${r.id}`)}
        toolbar={
          <div className="ml-auto flex items-center gap-2">
            {barcodeHint}
            <SavedFiltersMenu storageKey={VIEW_KEY} query={query} onQueryChange={setQuery} />
          </div>
        }
      />
    </div>
  )
}
