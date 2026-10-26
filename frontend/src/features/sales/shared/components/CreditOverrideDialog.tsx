import { ShieldAlert } from 'lucide-react'
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
import { useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { useExposure } from '../hooks/queries'
import { errorMessage, readCreditBreakdown } from '../lib/errors'
import { SALES_PERMS } from '../permissions'
import { ReasonDialog } from './ReasonDialog'

interface CreditOverrideDialogProps {
  /** The 422 sales.credit_limit_exceeded error; null keeps the dialog closed. */
  error: unknown
  onClose: () => void
  partyId: string
  /** The stored order / invoice: the exposure answer then says what it adds (risk currency). */
  documentId?: string | null
  /** This document's total and currency (shown when the API sends no breakdown). */
  documentTotal: string
  documentCurrency: string
  /** Repeats the blocked action with the override reason (audited by the API). */
  onOverride: (reason: string) => Promise<void>
}

/**
 * Credit limit block: the breakdown (limit, current exposure, this document) and, for users with
 * sales.credit_override, a reason to confirm over the limit; others can only close it.
 */
export function CreditOverrideDialog({
  error,
  onClose,
  partyId,
  documentId = null,
  documentTotal,
  documentCurrency,
  onOverride,
}: CreditOverrideDialogProps) {
  const { t } = useTranslation('sales-shared')
  const locale = useIntlLocale()
  const canOverride = usePermission(SALES_PERMS.creditOverride)
  const open = error !== null && error !== undefined
  const fromError = readCreditBreakdown(error)
  const exposure = useExposure(open ? partyId : '', documentId)
  const currency = fromError.currency ?? exposure.data?.currency ?? documentCurrency
  const limit = fromError.limit ?? exposure.data?.limit ?? null
  const current = fromError.exposure ?? exposure.data?.total ?? null
  // In the risk currency when the API tells (error details or the exposure answer).
  const riskDocument = fromError.document ?? exposure.data?.document_amount ?? null
  const doc = riskDocument ?? documentTotal
  const money = (v: string | null, c = currency) => (v === null ? '—' : formatMoney(v, c, locale))

  const breakdown = (
    <div className="space-y-2">
      <p className="flex items-start gap-2 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
        {errorMessage(error, t('credit.blocked'))}
      </p>
      <dl
        className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md border border-border bg-surface-sunken p-3 text-sm"
        aria-label={t('credit.breakdown')}
      >
        <dt className="text-muted-foreground">{t('credit.limit')}</dt>
        <dd className="text-right tabular-nums">{money(limit)}</dd>
        <dt className="text-muted-foreground">{t('credit.exposure')}</dt>
        <dd className="text-right tabular-nums">{money(current)}</dd>
        <dt className="text-muted-foreground">{t('credit.document')}</dt>
        <dd className="text-right tabular-nums">
          {money(doc, riskDocument !== null ? currency : documentCurrency)}
        </dd>
      </dl>
    </div>
  )

  if (canOverride) {
    return (
      <ReasonDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        title={t('credit.title')}
        description={t('credit.overrideBody')}
        label={t('credit.reason')}
        confirmLabel={t('credit.override')}
        tone="danger"
        minLength={10}
        onConfirm={onOverride}
      >
        {breakdown}
      </ReasonDialog>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('credit.title')}</DialogTitle>
          <DialogDescription>{t('credit.noPermission')}</DialogDescription>
        </DialogHeader>
        {breakdown}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
