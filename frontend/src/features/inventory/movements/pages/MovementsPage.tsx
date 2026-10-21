import { useInfiniteQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { DateInput, FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemCombobox } from '@/features/catalog'
import { INVALID_DATE } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { ExportButtons } from '../../stock/components/ExportButtons'
import { InventoryShell, LoadError, NativeSelect } from '../../stock/components/common'
import { SavedViewsMenu } from '../../stock/components/SavedViewsMenu'
import { WarehouseSelect } from '../../stock/components/WarehouseSelect'
import { INV_PATHS, movementsApi } from '../../stock/lib/api'
import { useInvT } from '../../stock/lib/i18n'
import { useInvKeys } from '../../stock/lib/keys'
import { MOVEMENT_TYPES } from '../../stock/lib/types'
import { MovementsTable } from '../components/MovementsTable'

const PAGE_SIZE = 100
/** Filters the ledger understands; they live in the URL as filter[name]. */
const MOVEMENT_FILTERS = [
  'item_id',
  'warehouse_id',
  'movement_type',
  'direction',
  'date_from',
  'date_to',
  'document_id',
  'lot_id',
  'serial_id',
] as const

const FILTER_PARAM = /^filter\[([^\]]+)\]$/

function readFilters(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of params) {
    const name = FILTER_PARAM.exec(key)?.[1]
    if (name && (MOVEMENT_FILTERS as readonly string[]).includes(name) && value !== '') {
      out[name] = value
    }
  }
  return out
}

/** Stock ledger: append-only movements, newest first, cursor paginated and virtualized. */
export function MovementsPage() {
  const t = useInvT()
  const keys = useInvKeys()
  const canPickItems = usePermission('items.view')
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => readFilters(params), [params])
  const dateError = filters.date_from === INVALID_DATE || filters.date_to === INVALID_DATE

  const ledger = useInfiniteQuery({
    queryKey: keys.movementList(filters),
    queryFn: ({ pageParam, signal }) => movementsApi.page(filters, pageParam, PAGE_SIZE, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    enabled: !dateError,
  })
  const rows = useMemo(() => ledger.data?.pages.flatMap((p) => p.rows) ?? [], [ledger.data])
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = ledger
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage])

  const setFilters = (next: Record<string, string>) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams()
        for (const [key, value] of prev) if (!FILTER_PARAM.test(key)) out.append(key, value)
        for (const [key, value] of Object.entries(next)) {
          if (value !== '') out.set(`filter[${key}]`, value)
        }
        return out
      },
      { replace: true },
    )
  const change = (key: string, value: string) => setFilters({ ...filters, [key]: value })
  const f = (key: string) => filters[key] ?? ''
  const filtered = Object.keys(filters).length > 0

  const exportParams = Object.fromEntries(
    Object.entries(filters).map(([k, v]) => [`filter[${k}]`, v]),
  )

  return (
    <InventoryShell
      title={t('movements.title')}
      description={t('movements.description')}
      actions={
        <>
          <SavedViewsMenu
            storageKey="movements"
            current={filters}
            onApply={(values) =>
              setFilters(
                Object.fromEntries(
                  Object.entries(values).filter(([k]) =>
                    (MOVEMENT_FILTERS as readonly string[]).includes(k),
                  ),
                ),
              )
            }
          />
          <ExportButtons
            path={INV_PATHS.movements}
            params={exportParams}
            filename="stok-hareketleri"
            disabled={dateError}
          />
        </>
      }
    >
      <div
        role="group"
        aria-label={t('common.filters')}
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
        <FieldShell label={t('fields.warehouse')} className="w-52">
          {(control) => (
            <WarehouseSelect
              {...control}
              value={f('warehouse_id')}
              onChange={(v) => change('warehouse_id', v)}
            />
          )}
        </FieldShell>
        {canPickItems && (
          <FieldShell label={t('fields.item')} className="w-72">
            {(control) => (
              <ItemCombobox
                {...control}
                type="stock"
                includeInactive
                value={f('item_id') || null}
                onChange={(id) => change('item_id', id ?? '')}
              />
            )}
          </FieldShell>
        )}
        <FieldShell label={t('fields.movementType')} className="w-48">
          {(control) => (
            <NativeSelect
              {...control}
              value={f('movement_type')}
              emptyLabel={t('common.all')}
              options={MOVEMENT_TYPES.map((m) => ({ value: m, label: t(`movementTypes.${m}`) }))}
              onChange={(e) => change('movement_type', e.target.value)}
            />
          )}
        </FieldShell>
        <FieldShell label={t('fields.direction')} className="w-36">
          {(control) => (
            <NativeSelect
              {...control}
              value={f('direction')}
              emptyLabel={t('common.all')}
              options={[
                { value: 'in', label: t('movements.directions.in') },
                { value: 'out', label: t('movements.directions.out') },
              ]}
              onChange={(e) => change('direction', e.target.value)}
            />
          )}
        </FieldShell>
        {filtered && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setFilters({})}>
            {t('common.clearFilters')}
          </Button>
        )}
      </div>

      {(filters.document_id ?? filters.lot_id ?? filters.serial_id) && (
        <p className="mb-2 text-sm text-muted-foreground" role="status">
          {t('movements.scoped')}
        </p>
      )}

      {dateError ? (
        <p role="alert" className="text-sm text-danger">
          {t('filters.invalidDate')}
        </p>
      ) : ledger.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : ledger.isError ? (
        <LoadError error={ledger.error} onRetry={() => void ledger.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('movements.emptyTitle')}
          description={filtered ? t('movements.emptyFiltered') : t('movements.emptyBody')}
        />
      ) : (
        <div className="space-y-2">
          <MovementsTable
            label={t('movements.title')}
            rows={rows}
            hasMore={hasNextPage}
            loadingMore={isFetchingNextPage}
            onEndReached={loadMore}
          />
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{t('movements.loaded', { count: rows.length })}</span>
            {hasNextPage && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isFetchingNextPage}
                onClick={loadMore}
              >
                {isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden="true" />}
                {t('movements.loadMore')}
              </Button>
            )}
          </div>
        </div>
      )}
    </InventoryShell>
  )
}
