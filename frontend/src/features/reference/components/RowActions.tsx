import { Pencil, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { platform } from '@/platform'
import { useRefT } from '../i18n'

interface RowActionsProps {
  /** Record name, used in the accessible labels ("Edit TRY"). */
  name: string
  onEdit?: () => void
  onDelete?: () => Promise<unknown>
  extra?: ReactNode
}

/** Edit and delete controls of a table row; delete is confirmed and failures are reported. */
export function RowActions({ name, onEdit, onDelete, extra }: RowActionsProps) {
  const t = useRefT()
  return (
    <div className="flex items-center justify-end gap-1">
      {extra}
      {onEdit && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('actions.editNamed', { name })}
          onClick={onEdit}
        >
          <Pencil aria-hidden="true" />
        </Button>
      )}
      {onDelete && (
        <ConfirmDialog
          title={t('actions.deleteTitle')}
          description={t('actions.deleteBody', { name })}
          confirmLabel={t('actions.delete')}
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label={t('actions.deleteNamed', { name })}>
              <Trash2 aria-hidden="true" />
            </Button>
          }
          onConfirm={async () => {
            try {
              await onDelete()
            } catch (error) {
              platform.notify.error(error instanceof Error ? error.message : t('errors.generic'))
              throw error
            }
          }}
        />
      )}
    </div>
  )
}
