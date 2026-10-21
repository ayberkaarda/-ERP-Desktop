import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { platform } from '@/platform'
import { ActionError } from '../../invoices/kit/components/ActionError'
import { VersionConflictAlert } from '../../invoices/kit/components/VersionConflictAlert'
import { isVersionConflict } from '../../invoices/kit/http'
import { usePayloadKeys } from '../../invoices/kit/idempotency'
import { activeCompany, invalidateSalesEffects, salesDocsKeys } from '../../invoices/kit/keys'
import { returnsApi, type SalesReturn } from '../api'
import type { ReturnAction, ReturnActionInput } from '../types'

interface ReturnActionDialogProps {
  ret: SalesReturn
  action: ReturnAction | null
  onClose: () => void
  onReload: () => void
}

/**
 * Confirms one step of the return (receive books at the return date, credit issues the credit
 * note today) and posts it with the stored version (Idempotency-Key). */
export function ReturnActionDialog({ ret, action, onClose, onReload }: ReturnActionDialogProps) {
  const { t } = useTranslation('sales-docs')
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const mutation = useMutation({
    mutationFn: ({ act }: { act: ReturnAction; company: string }) => {
      const body: ReturnActionInput = { version: ret.version }
      return returnsApi.action(ret.id, act, body, keyFor({ id: ret.id, act, ...body }))
    },
    onSuccess: (updated, { act, company }) => {
      queryClient.setQueryData(salesDocsKeys.detail('returns', updated.id, company), updated)
      invalidateSalesEffects(queryClient, company)
      keyFor.reset()
      if (activeCompany() !== company) return
      platform.notify.success(t(`returnAction.${act}.done`))
      onClose()
    },
  })
  const conflict = isVersionConflict(mutation.error)
  const open = action !== null
  const act = action ?? 'approve'

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !mutation.isPending && onClose()}>
      <DialogContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle>{t(`returnAction.${act}.title`)}</DialogTitle>
          <DialogDescription>{t(`returnAction.${act}.body`)}</DialogDescription>
        </DialogHeader>
        {conflict ? (
          <VersionConflictAlert
            onReload={() => {
              mutation.reset()
              onClose()
              onReload()
            }}
          />
        ) : (
          <ActionError error={mutation.error} />
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={onClose}>
            {t('actions.close')}
          </Button>
          <Button
            type="button"
            variant={act === 'cancel' ? 'danger' : 'primary'}
            disabled={mutation.isPending || conflict}
            onClick={() => mutation.mutate({ act, company: activeCompany() })}
          >
            {mutation.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {t(`returnAction.${act}.confirm`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
