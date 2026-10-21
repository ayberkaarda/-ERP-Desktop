import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateInput } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toIsoDate } from '@/lib/datetime'
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

/** Receive and credit take a posting date; cancel takes a reason; approve only confirms. */
const NEEDS_DATE: ReturnAction[] = ['receive', 'credit']

/** Confirms one step of the return and posts it with the stored version (Idempotency-Key). */
export function ReturnActionDialog({ ret, action, onClose, onReload }: ReturnActionDialogProps) {
  const { t } = useTranslation('sales-docs')
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const [date, setDate] = useState(() => toIsoDate(new Date()))
  const [reason, setReason] = useState('')
  const mutation = useMutation({
    mutationFn: ({ act }: { act: ReturnAction; company: string }) => {
      const body: ReturnActionInput = { version: ret.version }
      if (NEEDS_DATE.includes(act)) body.date = date
      if (act === 'cancel') body.reason = reason.trim()
      return returnsApi.action(ret.id, act, body, keyFor({ id: ret.id, act, ...body }))
    },
    onSuccess: (updated, { act, company }) => {
      queryClient.setQueryData(salesDocsKeys.detail('returns', updated.id, company), updated)
      invalidateSalesEffects(queryClient, company)
      keyFor.reset()
      if (activeCompany() !== company) return
      platform.notify.success(t(`returnAction.${act}.done`))
      setReason('')
      onClose()
    },
  })
  const conflict = isVersionConflict(mutation.error)
  const open = action !== null
  const act = action ?? 'approve'
  const invalid =
    (act === 'cancel' && reason.trim().length < 3) || (NEEDS_DATE.includes(act) && !date)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !mutation.isPending && onClose()}>
      <DialogContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle>{t(`returnAction.${act}.title`)}</DialogTitle>
          <DialogDescription>{t(`returnAction.${act}.body`)}</DialogDescription>
        </DialogHeader>
        {NEEDS_DATE.includes(act) && (
          <div className="space-y-1.5">
            <Label htmlFor="return-action-date">{t('fields.postingDate')}</Label>
            <DateInput
              id="return-action-date"
              value={date}
              min={ret.document_date}
              onChange={setDate}
            />
          </div>
        )}
        {act === 'cancel' && (
          <div className="space-y-1.5">
            <Label htmlFor="return-action-reason">{t('fields.reason')}</Label>
            <Textarea
              id="return-action-reason"
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
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
            disabled={mutation.isPending || conflict || invalid}
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
