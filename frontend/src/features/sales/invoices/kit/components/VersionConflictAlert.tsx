import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface VersionConflictAlertProps {
  onReload: () => void
  title?: string
  body?: string
  className?: string
}

/** Shown on 409 VERSION_CONFLICT: the user decides to reload; unsaved edits are not merged. */
export function VersionConflictAlert({
  onReload,
  title,
  body,
  className,
}: VersionConflictAlertProps) {
  const { t } = useTranslation('sales-docs')
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground',
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-semibold">{title ?? t('conflict.title')}</p>
        <p>{body ?? t('conflict.body')}</p>
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={onReload}>
        <RefreshCw aria-hidden="true" />
        {t('conflict.reload')}
      </Button>
    </div>
  )
}
