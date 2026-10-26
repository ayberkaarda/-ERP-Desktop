import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Award, Ban, Loader2, Send } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { errorMessage, isVersionConflict } from '@/features/sales/shared/lib/errors'
import { usePayloadKeys } from '@/features/sales/shared/lib/idempotency'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { rfqsApi } from '../../shared/api'
import { useComparison } from '../../shared/hooks/queries'
import { invalidatePurchasing, purchKeys } from '../../shared/lib/keys'
import { rfqActions } from '../../shared/lib/lifecycle'
import { PURCH_ACCESS } from '../../shared/permissions'
import type { PurchaseRfq } from '../../shared/types'
import { AwardDialog } from './AwardDialog'

type StateAction = 'send' | 'cancel'

interface RfqActionsProps {
  rfq: PurchaseRfq
  ensureSaved?: () => Promise<PurchaseRfq | null>
  onConflict: () => void
  busy?: boolean
}

/** RFQ lifecycle: send (numbers it), cancel, and award (one draft order per supplier). */
export function RfqActions({ rfq, ensureSaved, onConflict, busy = false }: RfqActionsProps) {
  const { t } = useTranslation('purchasing-orders')
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const company = useCompanyStore((s) => s.activeCompanyId)
  const canState = usePermission(PURCH_ACCESS.rfqState)
  const canAward = usePermission(PURCH_ACCESS.rfqAward)
  const allowed = rfqActions(rfq.status, rfq.quotes.length)
  const [confirming, setConfirming] = useState<{ action: StateAction; target: PurchaseRfq } | null>(
    null,
  )
  const [preparing, setPreparing] = useState(false)
  const [awarding, setAwarding] = useState(false)
  const comparison = useComparison(rfq.id, canAward && allowed.includes('award'))

  const run = useMutation({
    mutationFn: ({ action, target }: { action: StateAction; target: PurchaseRfq }) =>
      rfqsApi.transition(
        target.id,
        action,
        target.version,
        keyFor({ [action]: target.id, version: target.version }),
      ),
    onSuccess: ({ document: doc }, { action }) => {
      keyFor.reset()
      const started = company ?? 'none'
      queryClient.setQueryData(purchKeys.detail('rfq', doc.id, started), (prev?: PurchaseRfq) =>
        prev ? { ...doc, links: prev.links, audit: prev.audit } : doc,
      )
      invalidatePurchasing(queryClient, started)
      if (useCompanyStore.getState().activeCompanyId !== company) return
      platform.notify.success(t(`rfqs.done.${action}`, { number: doc.number ?? '' }))
    },
  })

  const open = async (action: StateAction) => {
    setPreparing(true)
    try {
      const target = ensureSaved && action === 'send' ? await ensureSaved() : rfq
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
          {t('rfqs.actions.cancel')}
        </Button>
      )}
      {canAward && allowed.includes('award') && (
        <Button
          type="button"
          disabled={pending || !comparison.data}
          onClick={() => setAwarding(true)}
        >
          <Award aria-hidden="true" />
          {t('rfqs.actions.award')}
        </Button>
      )}
      {canState && allowed.includes('send') && (
        <Button type="button" disabled={pending} onClick={() => void open('send')}>
          {run.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
          {t('rfqs.actions.send')}
        </Button>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o) setConfirming(null)
        }}
        tone={confirming?.action === 'cancel' ? 'danger' : 'primary'}
        title={confirming ? t(`rfqs.confirm.${confirming.action}.title`) : ''}
        description={
          confirming
            ? t(`rfqs.confirm.${confirming.action}.body`, {
                count: confirming.target.suppliers.length,
              })
            : ''
        }
        confirmLabel={confirming ? t(`rfqs.actions.${confirming.action}`) : ''}
        onConfirm={confirm}
      />
      <AwardDialog
        rfq={rfq}
        comparison={comparison.data}
        open={awarding}
        onClose={() => setAwarding(false)}
        onConflict={onConflict}
      />
    </>
  )
}
