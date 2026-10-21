import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

interface VersionConflictDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onReload: () => void | Promise<void>
}

/** VERSION_CONFLICT (409): the edit is based on a stale copy; offer to load the latest. */
export function VersionConflictDialog({
  open,
  onOpenChange,
  onReload,
}: VersionConflictDialogProps) {
  const { t } = useTranslation('parties')
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="primary"
      title={t('conflict.title')}
      description={t('conflict.body')}
      confirmLabel={t('conflict.reload')}
      cancelLabel={t('conflict.keep')}
      onConfirm={onReload}
    />
  )
}
