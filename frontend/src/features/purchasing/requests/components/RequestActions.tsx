import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, FileCheck2, FileQuestion, Loader2, Send } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { errorMessage, isVersionConflict } from '@/features/sales/shared/lib/errors'
import { usePayloadKeys } from '@/features/sales/shared/lib/idempotency'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { requestsApi } from '../../shared/api'
import { invalidatePurchasing, purchKeys } from '../../shared/lib/keys'
import { requestActions } from '../../shared/lib/lifecycle'
import { PURCH_ACCESS } from '../../shared/permissions'
import type { PurchaseRequest } from '../../shared/types'
import { RequestConvertDialog, type ConvertMode } from './RequestConvertDialog'

type StateAction = 'submit' | 'cancel'

interface RequestActionsProps {
  request: PurchaseRequest
  ensureSaved?: () => Promise<PurchaseRequest | null>
  onConflict: () => void
  onDone?: () => void
  busy?: boolean
}

/** Request lifecycle: submit (approval above the threshold), cancel, and RFQ / order drafts. */
export function RequestActions({
  request,
  ensureSaved,
  onConflict,
  onDone,
  busy = false,
}: RequestActionsProps) {
  const { t } = useTranslation('purchasing-orders')
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const company = useCompanyStore((s) => s.activeCompanyId)
  const canState = usePermission(PURCH_ACCESS.requestState)
  const canRfq = usePermission(PURCH_ACCESS.requestToRfq)
  const canOrder = usePermission(PURCH_ACCESS.requestToOrder)
  const allowed = requestActions(request.status, request.lines)
  const [confirming, setConfirming] = useState<{
    action: StateAction
    target: PurchaseRequest
  } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [convert, setConvert] = useState<ConvertMode | null>(null)

  const run = useMutation({
    mutationFn: ({ action, target }: { action: StateAction; target: PurchaseRequest }) =>
      requestsApi.transition(
        target.id,
        action,
        target.version,
        keyFor({ [action]: target.id, version: target.version }),
      ),
    onSuccess: ({ document: doc }, { action }) => {
      keyFor.reset()
      const started = company ?? 'none'
      queryClient.setQueryData(
        purchKeys.detail('request', doc.id, started),
        (prev?: PurchaseRequest) => (prev ? { ...doc, links: prev.links, audit: prev.audit } : doc),
      )
      invalidatePurchasing(queryClient, started)
      if (useCompanyStore.getState().activeCompanyId !== company) return
      platform.notify.success(
        action === 'submit'
          ? doc.status === 'pending_approval'
            ? t('requests.done.pendingApproval')
            : t('requests.done.approved')
          : t('requests.done.cancel'),
      )
      onDone?.()
    },
  })

  const open = async (action: StateAction) => {
    setPreparing(true)
    try {
      // Submitting acts on the saved draft; cancelling leaves pending edits alone.
      const target = ensureSaved && action === 'submit' ? await ensureSaved() : request
      if (target) setConfirming({ action, target })
    } finally {
      setPreparing(false)
    }
  }

  const confirm = async () => {
    if (!confirming) return
    try {
      await run.mutateAsync(confirming)
    } catch (error) {
      if (isVersionConflict(error)) onConflict()
      else platform.notify.error(errorMessage(error, t('errors.action')))
      throw error
    }
  }

  const pending = busy || preparing || run.isPending

  return (
    <>
      {canState && allowed.includes('cancel') && (
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => void open('cancel')}
        >
          <Ban aria-hidden="true" />
          {t('requests.actions.cancel')}
        </Button>
      )}
      {canRfq && allowed.includes('toRfq') && (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setConvert('rfq')}
        >
          <FileQuestion aria-hidden="true" />
          {t('requests.actions.toRfq')}
        </Button>
      )}
      {canOrder && allowed.includes('toOrder') && (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setConvert('order')}
        >
          <FileCheck2 aria-hidden="true" />
          {t('requests.actions.toOrder')}
        </Button>
      )}
      {canState && allowed.includes('submit') && (
        <Button type="button" disabled={pending} onClick={() => void open('submit')}>
          {run.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
          {t('requests.actions.submit')}
        </Button>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o) setConfirming(null)
        }}
        tone={confirming?.action === 'cancel' ? 'danger' : 'primary'}
        title={confirming ? t(`requests.confirm.${confirming.action}.title`) : ''}
        description={
          confirming
            ? t(`requests.confirm.${confirming.action}.body`, {
                number: confirming.target.number ?? t('common.unnumbered'),
              })
            : ''
        }
        confirmLabel={confirming ? t(`requests.actions.${confirming.action}`) : ''}
        onConfirm={confirm}
      />
      <RequestConvertDialog request={request} mode={convert} onClose={() => setConvert(null)} />
    </>
  )
}
