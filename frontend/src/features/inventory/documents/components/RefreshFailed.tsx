import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/** A background refetch failed while stale data is still on screen. */
export function RefreshFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('inventoryDocs')
  return (
    <div className="mx-auto max-w-[1440px] px-6 pt-4">
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground"
      >
        <span>{t('errors.refreshFailed')}</span>
        <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
          {t('actions.retry')}
        </Button>
      </div>
    </div>
  )
}
