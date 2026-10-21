import { useInfiniteQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '../../stock/components/Drawer'
import { LoadError } from '../../stock/components/common'
import { movementsApi } from '../../stock/lib/api'
import { useInvT } from '../../stock/lib/i18n'
import { useInvKeys } from '../../stock/lib/keys'
import type { StockSerial } from '../../stock/lib/types'
import { MovementsTable } from '../../movements/components/MovementsTable'

const PAGE_SIZE = 100

/** Movements of one serial unit, newest first (its trace), loaded page by page by cursor. */
export function SerialHistoryDrawer({
  serial,
  onClose,
}: {
  serial: StockSerial | null
  onClose: () => void
}) {
  const t = useInvT()
  const keys = useInvKeys()
  const filters = useMemo(() => ({ serial_id: serial?.id ?? '' }), [serial])
  const history = useInfiniteQuery({
    queryKey: keys.movementList(filters),
    queryFn: ({ pageParam, signal }) => movementsApi.page(filters, pageParam, PAGE_SIZE, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    enabled: serial !== null,
  })
  const rows = useMemo(() => history.data?.pages.flatMap((p) => p.rows) ?? [], [history.data])
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = history
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage])

  return (
    <Drawer
      open={serial !== null}
      onOpenChange={(open) => !open && onClose()}
      title={serial ? t('serials.historyTitle', { serial: serial.serial_no }) : ''}
      description={serial ? `${serial.item.code} · ${serial.item.name}` : undefined}
      className="max-w-3xl"
    >
      {history.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : history.isError ? (
        <LoadError error={history.error} onRetry={() => void history.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('trace.noMovements')}</p>
      ) : (
        <div className="space-y-2">
          <MovementsTable
            label={t('serials.history')}
            rows={rows}
            hideItem
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
    </Drawer>
  )
}
