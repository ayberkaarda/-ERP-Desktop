import { createColumnHelper } from '@tanstack/react-table'
import { ChevronDown, FilterX, Plus } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import {
  DataTable,
  setFilter,
  updateListQuery,
  useUrlListQuery,
  type ListQueryState,
} from '@/components/shared/data-table'
import { DateInput, FieldShell } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { Can } from '@/lib/permissions'
import { ItemCombobox } from '@/features/catalog'
import { documentsApi } from '../api/client'
import { DocStatusBadge } from '../components/DocStatusBadge'
import { DOCS_BASE } from '../components/DocumentEditor'
import { ExportButtons } from '../components/ExportButtons'
import { WarehouseSelect } from '../components/pickers'
import { PresetsMenu } from '../components/PresetsMenu'
import { useStockWarehouses } from '../../shared/warehouses'
import { useDocumentList } from '../hooks/queries'
import { INV_PERMS } from '../permissions'
import { DOC_STATUSES, DOC_TYPES, EDITABLE_DOC_TYPES, type StockDocumentSummary } from '../types'

export const COUNTS_BASE = '/inventory/counts'

interface ListProps {
  /** Counts list: fixed to doc_type=count, rows open the count workflow. */
  mode?: 'documents' | 'counts'
}

const FILTERS = ['date_from', 'date_to', 'warehouse_id', 'item_id', 'doc_type', 'status'] as const
const PRESET_KEYS = ['q', ...FILTERS] as const

/** Stock documents (or counts) with filters, saved views, export and creation by type. */
export function StockDocumentListPage({ mode = 'documents' }: ListProps) {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const counts = mode === 'counts'
  const viewKey = counts ? 'inventory.counts' : 'inventory.documents'
  const base = counts ? COUNTS_BASE : DOCS_BASE
  const { query: urlQuery, setQuery } = useUrlListQuery(
    { sort: [{ id: 'document_date', desc: true }] },
    { viewKey },
  )
  // The counts list always asks for counts; the type filter is not offered there.
  const query: ListQueryState = counts ? setFilter(urlQuery, 'doc_type', 'count') : urlQuery
  const list = useDocumentList(query)
  const warehouses = useStockWarehouses()
  const warehouseData = warehouses.data
  const f = (key: string) => urlQuery.filters[key] ?? ''
  const change = (key: string, value: string) => setQuery(setFilter(urlQuery, key, value))

  const applyPreset = (params: Record<string, string>) => {
    let next: ListQueryState = updateListQuery(urlQuery, { q: params.q ?? '', filters: {} })
    for (const key of FILTERS) if (params[key]) next = setFilter(next, key, params[key])
    setQuery(next)
  }

  const columns = useMemo(() => {
    const col = createColumnHelper<StockDocumentSummary>()
    return [
      col.accessor('number', {
        header: t('fields.number'),
        enableSorting: true,
        meta: { label: t('fields.number') },
        size: 150,
        cell: (c) => (
          <Link to={`${base}/${c.row.original.id}`} className="font-code hover:underline">
            {c.getValue() ?? t('list.unnumbered')}
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
      ...(counts
        ? []
        : [
            col.accessor('doc_type', {
              header: t('fields.docType'),
              meta: {
                label: t('fields.docType'),
                filter: {
                  key: 'doc_type',
                  options: DOC_TYPES.map((v) => ({ value: v, label: t(`docType.${v}`) })),
                },
              },
              size: 120,
              cell: (c) => t(`docType.${c.getValue()}`),
            }),
          ]),
      col.accessor('warehouse_id', {
        header: t('fields.warehouse'),
        meta: { label: t('fields.warehouse') },
        size: 200,
        cell: (c) => {
          const r = c.row.original
          const label = (id: string | null) => {
            const w = warehouseData?.find((x) => x.id === id)
            return w ? `${w.code} · ${w.name}` : ''
          }
          const target = warehouseData?.find((x) => x.id === r.target_warehouse_id)
          return r.target_warehouse_id
            ? `${label(r.warehouse_id)} → ${target?.code ?? ''}`
            : label(r.warehouse_id)
        },
      }),
      col.accessor('reason', {
        header: t('fields.reason'),
        meta: { label: t('fields.reason') },
        size: 240,
        cell: (c) => c.getValue() ?? '',
      }),
      col.accessor('line_count', {
        header: t('fields.lineCount'),
        meta: { label: t('fields.lineCount'), align: 'right' },
        size: 80,
        cell: (c) => <span className="tabular-nums">{c.getValue() ?? ''}</span>,
      }),
      col.accessor('status', {
        header: t('fields.status'),
        meta: {
          label: t('fields.status'),
          filter: {
            key: 'status',
            options: DOC_STATUSES.map((v) => ({ value: v, label: t(`status.${v}`) })),
          },
        },
        size: 120,
        cell: (c) => <DocStatusBadge status={c.getValue()} />,
      }),
      col.accessor('source_type', {
        header: t('fields.source'),
        meta: { label: t('fields.source') },
        size: 120,
        cell: (c) => c.getValue() ?? t('list.manual'),
      }),
    ]
  }, [t, locale, counts, base, warehouseData])

  const filtered = FILTERS.some((k) => f(k) !== '') || urlQuery.q !== ''
  const exportParams = Object.fromEntries(
    Object.entries({
      q: query.q,
      ...Object.fromEntries(Object.entries(query.filters).map(([k, v]) => [`filter[${k}]`, v])),
    }).filter(([, v]) => v !== ''),
  )
  const title = counts ? t('count.listTitle') : t('list.title')

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={title}
        description={counts ? t('count.listDescription') : t('list.description')}
        breadcrumbs={[{ label: t('nav.inventory') }, { label: title }]}
        actions={
          <>
            <ExportButtons
              path={documentsApi.path}
              params={exportParams}
              filename={counts ? 'stok-sayimlari' : 'stok-fisleri'}
            />
            <Can permission={INV_PERMS.documents.create}>
              {counts ? (
                <Button asChild>
                  <Link to={`${COUNTS_BASE}/new`}>
                    <Plus aria-hidden="true" />
                    {t('count.new')}
                  </Link>
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button>
                      <Plus aria-hidden="true" />
                      {t('list.new')}
                      <ChevronDown aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {EDITABLE_DOC_TYPES.map((type) => (
                      <DropdownMenuItem
                        key={type}
                        onSelect={() => void navigate(`${DOCS_BASE}/new?type=${type}`)}
                      >
                        {t(`docType.${type}`)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </Can>
          </>
        }
      />
      <section
        aria-label={t('list.filters')}
        className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
      >
        <FieldShell label={t('filters.dateFrom')} className="w-40">
          {(control) => (
            <DateInput
              {...control}
              value={f('date_from')}
              max={f('date_to') || undefined}
              onChange={(v) => change('date_from', v)}
            />
          )}
        </FieldShell>
        <FieldShell label={t('filters.dateTo')} className="w-40">
          {(control) => (
            <DateInput
              {...control}
              value={f('date_to')}
              min={f('date_from') || undefined}
              onChange={(v) => change('date_to', v)}
            />
          )}
        </FieldShell>
        <FieldShell label={t('filters.warehouse')} className="w-56">
          {(control) => (
            <WarehouseSelect
              {...control}
              clearable
              value={f('warehouse_id')}
              onChange={(v) => change('warehouse_id', v)}
            />
          )}
        </FieldShell>
        <FieldShell label={t('filters.item')} className="w-64">
          {(control) => (
            <ItemCombobox
              {...control}
              value={f('item_id') || null}
              onChange={(id) => change('item_id', id ?? '')}
            />
          )}
        </FieldShell>
        <div className="ml-auto flex items-center gap-2">
          {filtered && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setQuery(updateListQuery(urlQuery, { q: '', filters: {} }))}
            >
              <FilterX aria-hidden="true" />
              {t('filters.clear')}
            </Button>
          )}
          <PresetsMenu
            storageKey={viewKey}
            allowed={PRESET_KEYS}
            title={t('presets.views')}
            current={{ q: urlQuery.q, ...urlQuery.filters }}
            onApply={applyPreset}
          />
        </div>
      </section>
      <DataTable<StockDocumentSummary>
        label={title}
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
        onRowActivate={(r) => void navigate(`${base}/${r.id}`)}
      />
    </div>
  )
}
