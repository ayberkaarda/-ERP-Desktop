import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  Ban,
  FilePenLine,
  Loader2,
  PackageCheck,
  ReceiptText,
  Send,
  SendHorizontal,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { errorMessage, isVersionConflict } from '@/features/sales/shared/lib/errors'
import { usePayloadKeys } from '@/features/sales/shared/lib/idempotency'
import { useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { ordersApi } from '../../shared/api'
import { useOverReceiptPercent } from '../../shared/hooks/queries'
import { invalidatePurchasing, purchKeys } from '../../shared/lib/keys'
import { orderActions, type WizardMode } from '../../shared/lib/lifecycle'
import { notifyWarnings } from '../../shared/lib/notify'
import { PURCH_ACCESS } from '../../shared/permissions'
import type { PurchaseOrder } from '../../shared/types'
import { OrderWizard } from './OrderWizard'

type StateAction = 'submit' | 'send' | 'cancel' | 'close'

interface OrderActionsProps {
  order: PurchaseOrder
  /** Saves pending edits of a draft first (editor); read-only pages pass nothing. */
  ensureSaved?: () => Promise<PurchaseOrder | null>
  onConflict: () => void
  /** Opens the editor in revise mode. */
  onRevise?: () => void
  /** After a state change of this order (the page leaves the editor). */
  onDone?: () => void
  busy?: boolean
}

/**
 * Order lifecycle: submit (approval above the threshold), send to the supplier, revise before
 * receipts and invoices, cancel, close, and the receipt / invoice wizard with partial quantities.
 * Each button needs its permission and the state that allows it; the server re-checks both.
 */
export function OrderActions({
  order,
  ensureSaved,
  onConflict,
  onRevise,
  onDone,
  busy = false,
}: OrderActionsProps) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const company = useCompanyStore((s) => s.activeCompanyId)
  const can = {
    submit: usePermission(PURCH_ACCESS.orderSubmit),
    revise: usePermission(PURCH_ACCESS.orderRevise),
    send: usePermission(PURCH_ACCESS.orderSend),
    cancel: usePermission(PURCH_ACCESS.orderCancel),
    close: usePermission(PURCH_ACCESS.orderClose),
    receipt: usePermission(PURCH_ACCESS.createReceipt),
    invoice: usePermission(PURCH_ACCESS.createInvoice),
  }
  const overReceipt = useOverReceiptPercent()
  const allowed = orderActions(order)
  /** The stored order a confirmation describes and acts on (edits are saved first). */
  const [confirming, setConfirming] = useState<{
    action: StateAction
    target: PurchaseOrder
  } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [wizard, setWizard] = useState<WizardMode | null>(null)

  const run = useMutation({
    mutationFn: ({ action, target }: { action: StateAction; target: PurchaseOrder }) =>
      ordersApi.transition(
        target.id,
        action,
        target.version,
        keyFor({ [action]: target.id, version: target.version }),
      ),
    onSuccess: ({ document: doc, warnings }, { action }) => {
      keyFor.reset()
      const started = company ?? 'none'
      queryClient.setQueryData(
        purchKeys.detail('order', doc.id, started),
        (prev?: PurchaseOrder) => (prev ? { ...doc, links: prev.links, audit: prev.audit } : doc),
      )
      invalidatePurchasing(queryClient, started)
      if (useCompanyStore.getState().activeCompanyId !== company) return
      notifyWarnings(warnings)
      platform.notify.success(
        action === 'submit' && doc.status === 'pending_approval'
          ? t('orders.done.pendingApproval')
          : t(`orders.done.${action}`),
      )
      onDone?.()
    },
  })

  const open = async (action: StateAction) => {
    setPreparing(true)
    try {
      // Validation or save errors are shown in the form; no dialog opens.
      // Submitting acts on the saved draft; cancelling leaves pending edits alone.
      const target = ensureSaved && action === 'submit' ? await ensureSaved() : order
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
  const show = (action: Parameters<typeof allowed.includes>[0], permitted: boolean) =>
    permitted && allowed.includes(action)

  return (
    <>
      {show('cancel', can.cancel) && (
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => void open('cancel')}
        >
          <Ban aria-hidden="true" />
          {t('orders.actions.cancel')}
        </Button>
      )}
      {show('close', can.close) && (
        <Button type="button" variant="ghost" disabled={pending} onClick={() => void open('close')}>
          <Archive aria-hidden="true" />
          {t('orders.actions.close')}
        </Button>
      )}
      {show('revise', can.revise) && onRevise && (
        <Button type="button" variant="secondary" disabled={pending} onClick={onRevise}>
          <FilePenLine aria-hidden="true" />
          {t('orders.actions.revise')}
        </Button>
      )}
      {show('createReceipt', can.receipt) && (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setWizard('receipt')}
        >
          <PackageCheck aria-hidden="true" />
          {t('orders.actions.createReceipt')}
        </Button>
      )}
      {show('createInvoice', can.invoice) && (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setWizard('invoice')}
        >
          <ReceiptText aria-hidden="true" />
          {t('orders.actions.createInvoice')}
        </Button>
      )}
      {show('send', can.send) && (
        <Button type="button" disabled={pending} onClick={() => void open('send')}>
          <SendHorizontal aria-hidden="true" />
          {t('orders.actions.send')}
        </Button>
      )}
      {show('submit', can.submit) && (
        <Button type="button" disabled={pending} onClick={() => void open('submit')}>
          {run.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
          {t('orders.actions.submit')}
        </Button>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o) setConfirming(null)
        }}
        tone={confirming?.action === 'cancel' ? 'danger' : 'primary'}
        title={confirming ? t(`orders.confirm.${confirming.action}.title`) : ''}
        description={
          confirming
            ? t(`orders.confirm.${confirming.action}.body`, {
                number: confirming.target.number ?? t('common.unnumbered'),
                supplier: confirming.target.party_name,
                total: formatMoney(
                  confirming.target.total,
                  confirming.target.currency_code,
                  locale,
                ),
              })
            : ''
        }
        confirmLabel={confirming ? t(`orders.actions.${confirming.action}`) : ''}
        onConfirm={confirm}
      />
      <OrderWizard
        order={order}
        mode={wizard}
        overReceiptPercent={overReceipt}
        onClose={() => setWizard(null)}
      />
    </>
  )
}
