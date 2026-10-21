import { Button } from '@/components/ui/button'
import { isApiError } from '@/platform'
import { LIMIT_EXCEEDED } from '../api/client'
import { useRefT } from '../i18n'

/** Inline failure state with a retry action, for blocks that are not a DataTable. */
export function LoadError({ onRetry, error }: { onRetry: () => void; error?: unknown }) {
  const t = useRefT()
  const tooMany = isApiError(error) && error.code === LIMIT_EXCEEDED
  return (
    <div role="alert" className="flex items-center gap-3 text-sm text-danger">
      <span>{tooMany ? t('errors.limitExceeded') : t('errors.load')}</span>
      {!tooMany && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('actions.retry')}
        </Button>
      )}
    </div>
  )
}
