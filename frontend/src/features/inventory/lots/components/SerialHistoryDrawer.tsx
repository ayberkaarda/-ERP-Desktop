import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { Drawer } from '../../stock/components/Drawer'
import { LoadError } from '../../stock/components/common'
import { movementsApi } from '../../stock/lib/api'
import { useInvT } from '../../stock/lib/i18n'
import { useInvKeys } from '../../stock/lib/keys'
import type { StockSerial } from '../../stock/lib/types'
import { MovementsTable } from '../../movements/components/MovementsTable'

/** Movements of one serial unit, newest first (its trace). */
export function SerialHistoryDrawer({
  serial,
  onClose,
}: {
  serial: StockSerial | null
  onClose: () => void
}) {
  const t = useInvT()
  const keys = useInvKeys()
  const history = useQuery({
    queryKey: keys.movementList({ serial_id: serial?.id ?? '', limit: '200' }),
    queryFn: ({ signal }) => movementsApi.page({ serial_id: serial?.id ?? '' }, null, 100, signal),
    enabled: serial !== null,
  })
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
      ) : history.data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('trace.noMovements')}</p>
      ) : (
        <MovementsTable label={t('serials.history')} rows={history.data.rows} hideItem />
      )}
    </Drawer>
  )
}
