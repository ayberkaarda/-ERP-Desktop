import { Button } from '@/components/ui/button'
import { useRefT } from '../i18n'

/** Inline failure state with a retry action, for blocks that are not a DataTable. */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useRefT()
  return (
    <div role="alert" className="flex items-center gap-3 text-sm text-danger">
      <span>{t('errors.load')}</span>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {t('actions.retry')}
      </Button>
    </div>
  )
}
