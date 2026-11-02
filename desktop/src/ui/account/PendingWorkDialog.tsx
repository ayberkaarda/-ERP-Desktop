import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

import { useTd } from '../../i18n'
import type { PendingWorkAnswer, PendingWorkRequest } from './services'

/**
 * Unsent work would be deleted by a sign-out, company switch or profile
 * reset/removal: go on (the work is lost), keep it, or open the outbox.
 */
export function PendingWorkDialog({
  request,
  canShow,
  onAnswer,
}: {
  request: PendingWorkRequest | null
  /** False while the gate shows its own screens: there is no router to open the outbox. */
  canShow: boolean
  onAnswer: (answer: PendingWorkAnswer) => void
}) {
  const td = useTd()
  const counted = request?.outbox !== undefined && request.conflicts !== undefined
  return (
    <AlertDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onAnswer('keep')
      }}
    >
      <AlertDialogContent data-testid="pending-work-dialog">
        <div className="space-y-1.5">
          <AlertDialogTitle>{td('account.pending.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {request ? td(`account.pending.action.${request.action}`) : null}{' '}
            {counted
              ? td('account.pending.body', { outbox: request.outbox, conflicts: request.conflicts })
              : td('account.pending.unknown')}
          </AlertDialogDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {canShow ? (
            <Button variant="ghost" onClick={() => onAnswer('show')} data-testid="pending-work-show">
              {td('account.pending.show')}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => onAnswer('keep')} data-testid="pending-work-keep">
            {td('account.pending.keep')}
          </Button>
          <Button variant="danger" onClick={() => onAnswer('discard')} data-testid="pending-work-discard">
            {td('account.pending.discard')}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
