import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { platform } from '@/platform'
import { cn } from '@/lib/utils'

const subscribe = (cb: () => void) => platform.connectivity.subscribe(cb)
const snapshot = () => platform.connectivity.isOnline()

export function ConnectivityBadge() {
  const { t } = useTranslation()
  const online = useSyncExternalStore(subscribe, snapshot, () => true)
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 px-2 text-xs text-muted-foreground"
    >
      <span
        className={cn('size-1.5 rounded-full', online ? 'bg-success' : 'bg-danger animate-pulse')}
      />
      {online ? t('common.online') : t('common.offline')}
    </span>
  )
}
