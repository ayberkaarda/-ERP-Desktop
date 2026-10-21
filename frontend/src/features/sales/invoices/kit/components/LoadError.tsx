import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { errorMessage } from '../http'

/** Failed load with the server's reason and a retry. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation('sales-docs')
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-border bg-surface py-8 text-center text-sm"
    >
      <p className="font-medium">{t('errors.loadFailed')}</p>
      <p className="text-muted-foreground">{errorMessage(error, t('errors.generic'))}</p>
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        {t('actions.retry')}
      </Button>
    </div>
  )
}
