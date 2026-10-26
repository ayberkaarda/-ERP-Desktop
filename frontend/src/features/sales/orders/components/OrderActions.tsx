import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  Ban,
  CheckCheck,
  FilePenLine,
  Loader2,
  PackageCheck,
  ReceiptText,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { ordersApi, type SalesOrder } from '../../shared/api'
import { CreditOverrideDialog } from '../../shared/components/CreditOverrideDialog'
import { useOverDeliveryPercent } from '../../shared/hooks/queries'
import { notifyWarnings } from '../../shared/lib/notify'
import { errorMessage, isCreditLimitExceeded, isVersionConflict } from '../../shared/lib/errors'
import type { FulfilmentMode } from '../../shared/lib/fulfilment'
import { usePayloadKeys } from '../../shared/lib/idempotency'
import { invalidateSales, salesKeys } from '../../shared/lib/keys'
import { orderActions } from '../../shared/lib/lifecycle'
import { SALES_ACCESS } from '../../shared/permissions'
import { FulfilmentWizard } from './FulfilmentWizard'

interface OrderActionsProps {
  order: SalesOrder
  /** Saves pending edits of a draft first (editor); read-only pages pass nothing. */
  ensureSaved?: () => Promise<SalesOrder | null>
  onConflict: () => void
  /** Opens the editor in revise mode. */
  onRevise?: () => void
  /** After a state change of this order (the page leaves the editor). */
  onDone?: () => void
  busy?: boolean
}

/**
 * Order lifecycle: confirm (credit warn/block with the override dialog, approval above the
 * threshold), revise before deliveries, cancel, close, and the delivery / invoice wizard.
 */
export function OrderActions({
  order,
  ensureSaved,
  onConflict,
  onRevise,
  onDone,
  busy = false,
}: OrderActionsProps) {
  const { t } = useTranslation('sales-orders')
  const locale = useIntlLocale()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const company = useCompanyStore((s) => s.activeCompanyId)
  const canConfirm = usePermission(SALES_ACCESS.orderConfirm)
  const canRevise = usePermission(SALES_ACCESS.orderRevise)
  const canCancel = usePermission(SALES_ACCESS.orderCancel)
  const canClose = usePermission(SALES_ACCESS.orderClose)
  const canDeliver = usePermission(SALES_ACCESS.createDelivery)
  const canInvoice = usePermission(SALES_ACCESS.createInvoice)
  /** The saved order the confirmation describes and confirms (edits are saved first). */
  const [confirming, setConfirming] = useState<SalesOrder | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [closing, setClosing] = useState(false)
  const [credit, setCredit] = useState<{ error: unknown; target: SalesOrder } | null>(null)
  const [wizard, setWizard] = useState<FulfilmentMode | null>(null)
  // Tolerance of the company setting when readable; null = the server bounds deliveries alone.
  const overDelivery = useOverDeliveryPercent()
  const withTolerance: SalesOrder = { ...order, over_delivery_percent: overDelivery }
  const allowed = orderActions(withTolerance)

  const settle = (doc: SalesOrder) => {
    keyFor.reset()
    const started = company ?? 'none'
    queryClient.setQueryData(salesKeys.detail('order', doc.id, started), doc)
    invalidateSales(queryClient, started)
  }

  const confirm = useMutation({
    mutationFn: ({ target, reason }: { target: SalesOrder; reason?: string }) => {
      const input = {
        version: target.version,
        ...(reason ? { credit_override_reason: reason } : {}),
      }
      return ordersApi.confirm(target.id, input, keyFor({ confirm: target.id, ...input }))
    },
    onSuccess: ({ document: doc, warnings }) => {
      settle(doc)
      if (useCompanyStore.getState().activeCompanyId !== company) return
      notifyWarnings(warnings)
      platform.notify.success(
        doc.status === 'pending_approval' ? t('actions.sentForApproval') : t('actions.confirmed'),
      )
      setCredit(null)
      onDone?.()
    },
  })

  const cancel = useMutation({
    mutationFn: ({ target }: { target: SalesOrder }) =>
      ordersApi.cancel(
        target.id,
        target.version,
        keyFor({ cancel: target.id, version: target.version }),
      ),
    onSuccess: ({ document: doc }) => {
      settle(doc)
      if (useCompanyStore.getState().activeCompanyId !== company) return
      platform.notify.success(t('actions.cancelled'))
      onDone?.()
    },
  })

  const close = useMutation({
    mutationFn: ({ target }: { target: SalesOrder }) =>
      ordersApi.close(
        target.id,
        target.version,
        keyFor({ close: target.id, version: target.version }),
      ),
    onSuccess: ({ document: doc }) => {
      settle(doc)
      if (useCompanyStore.getState().activeCompanyId !== company) return
      platform.notify.success(t('actions.closed'))
      onDone?.()
    },
  })

  const target = async () => (ensureSaved ? await ensureSaved() : order)

  /** Credit blocks open the override dialog; conflicts ask for a reload; others toast. */
  const openConfirm = async () => {
    setPreparing(true)
    try {
      // Validation or save errors are shown in the form; no dialog opens.
      const doc = await target()
      if (doc) setConfirming(doc)
    } finally {
      setPreparing(false)
    }
  }

  const runConfirm = async () => {
    const doc = confirming
    if (!doc) return
    try {
      await confirm.mutateAsync({ target: doc })
    } catch (error) {
      if (isCreditLimitExceeded(error)) {
        setCredit({ error, target: doc })
        return
      }
      if (isVersionConflict(error)) onConflict()
      else platform.notify.error(errorMessage(error, t('actions.failed')))
      throw error
    }
  }

  const runCancel = async () => {
    const doc = await target()
    // Validation or save errors are shown in the form; the dialog closes.
    if (!doc) return
    try {
      await cancel.mutateAsync({ target: doc })
    } catch (error) {
      if (isVersionConflict(error)) onConflict()
      else platform.notify.error(errorMessage(error, t('actions.failed')))
      throw error
    }
  }

  const runClose = async () => {
    try {
      await close.mutateAsync({ target: order })
    } catch (error) {
      if (isVersionConflict(error)) onConflict()
      else platform.notify.error(errorMessage(error, t('actions.failed')))
      throw error
    }
  }

  const pending = busy || preparing || confirm.isPending || cancel.isPending || close.isPending

  return (
    <>
      {canCancel && allowed.includes('cancel') && (
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => setCancelling(true)}
        >
          <Ban aria-hidden="true" />
          {t('actions.cancel')}
        </Button>
      )}
      {canClose && allowed.includes('close') && (
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setClosing(true)}>
          <Archive aria-hidden="true" />
          {t('actions.close')}
        </Button>
      )}
      {canRevise && onRevise && allowed.includes('revise') && (
        <Button type="button" variant="secondary" disabled={pending} onClick={onRevise}>
          <FilePenLine aria-hidden="true" />
          {t('actions.revise')}
        </Button>
      )}
      {canDeliver && allowed.includes('createDelivery') && (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setWizard('delivery')}
        >
          <PackageCheck aria-hidden="true" />
          {t('actions.createDelivery')}
        </Button>
      )}
      {canInvoice && allowed.includes('createInvoice') && (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setWizard('invoice')}
        >
          <ReceiptText aria-hidden="true" />
          {t('actions.createInvoice')}
        </Button>
      )}
      {canConfirm && allowed.includes('confirm') && (
        <Button type="button" disabled={pending} onClick={() => void openConfirm()}>
          {confirm.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <CheckCheck aria-hidden="true" />
          )}
          {t('actions.confirm')}
        </Button>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        tone="primary"
        title={t('confirm.title')}
        description={t('confirm.body', {
          number: confirming?.number ?? '',
          customer: confirming?.party.name ?? '',
          total: confirming ? formatMoney(confirming.total, confirming.currency_code, locale) : '',
        })}
        confirmLabel={t('actions.confirm')}
        onConfirm={runConfirm}
      />
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t('cancel.title')}
        description={t('cancel.body')}
        confirmLabel={t('actions.cancel')}
        onConfirm={runCancel}
      />
      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        tone="primary"
        title={t('closeOrder.title')}
        description={t('closeOrder.body')}
        confirmLabel={t('actions.close')}
        onConfirm={runClose}
      />
      <CreditOverrideDialog
        error={credit?.error ?? null}
        onClose={() => setCredit(null)}
        partyId={order.party_id}
        documentId={credit?.target.id ?? null}
        documentTotal={order.total}
        documentCurrency={order.currency_code}
        onOverride={async (reason) => {
          if (!credit) return
          await confirm.mutateAsync({ target: credit.target, reason })
        }}
      />
      <FulfilmentWizard order={withTolerance} mode={wizard} onClose={() => setWizard(null)} />
    </>
  )
}
