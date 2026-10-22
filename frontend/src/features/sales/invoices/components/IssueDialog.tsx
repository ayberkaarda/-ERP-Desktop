import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { invoicesApi, type Invoice } from '../api'
import { ActionError } from '../kit/components/ActionError'
import { VersionConflictAlert } from '../../shared/components/common'
import { creditBreakdown, isCreditBlocked, isVersionConflict } from '../kit/http'
import { usePayloadKeys } from '../../shared/lib/idempotency'
import { activeCompany, invalidateSalesEffects, salesDocsKeys } from '../kit/keys'
import { money } from '../kit/money'
import { SALES_PERMS } from '../kit/permissions'
import { useCompanyCurrency } from '../kit/viewKey'
import { documentInRisk } from '../lib/exposure'
import { useExposure } from '../queries'

interface IssueDialogProps {
  invoice: Invoice
  open: boolean
  onOpenChange: (open: boolean) => void
  onIssued: (invoice: Invoice) => void
  onReload: () => void
}

/**
 * Issue confirmation: the customer's exposure against the risk limit, then
 * POST /sales-invoices/{id}/issue {version}. A block-mode refusal offers the override (with a
 * reason) to holders of sales.credit_override; warn-mode notes come back in meta.warnings.
 */
export function IssueDialog({ invoice, open, onOpenChange, onIssued, onReload }: IssueDialogProps) {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const canOverride = usePermission(SALES_PERMS.creditOverride)
  const isSale = invoice.invoice_type === 'sale'
  const companyCurrency = useCompanyCurrency()
  const exposure = useExposure(invoice.party_id, open && isSale, invoice.id)
  const [reason, setReason] = useState('')

  const issue = useMutation({
    mutationFn: ({ override }: { override: string | null; company: string }) => {
      const body = override
        ? { version: invoice.version, credit_override_reason: override }
        : { version: invoice.version }
      return invoicesApi.issue(invoice.id, body, keyFor({ issue: invoice.id, ...body }))
    },
    onSuccess: ({ invoice: issued, warnings }, { company }) => {
      queryClient.setQueryData(salesDocsKeys.detail('invoices', issued.id, company), issued)
      invalidateSalesEffects(queryClient, company)
      keyFor.reset()
      if (activeCompany() !== company) return
      for (const w of warnings) platform.notify.warning(w.message)
      if (issued.status === 'pending_approval') platform.notify.info(t('invoice.approvalStarted'))
      setReason('')
      onOpenChange(false)
      onIssued(issued)
    },
  })
  const blocked = isCreditBlocked(issue.error)
  const breakdown = creditBreakdown(issue.error)
  const conflict = isVersionConflict(issue.error)
  const e = exposure.data
  // Only amounts in the risk currency are compared with the limit (lib/exposure).
  const risk = e ? documentInRisk(e, invoice, companyCurrency) : null
  const after = risk?.after ?? null
  const busy = issue.isPending

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('issue.title')}</DialogTitle>
          <DialogDescription>
            {t('issue.body', {
              party: invoice.party_snapshot?.name ?? invoice.party_name ?? '',
              date: formatDate(invoice.document_date, locale),
              total: money(invoice.total, locale, invoice.currency_code),
            })}
          </DialogDescription>
        </DialogHeader>
        {isSale && e && (
          <dl
            className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border p-3 text-sm"
            data-testid="exposure"
          >
            <dt className="text-muted-foreground">{t('exposure.limit')}</dt>
            <dd className="text-right tabular-nums">
              {e.limit === null ? t('exposure.unlimited') : money(e.limit, locale, e.currency)}
            </dd>
            <dt className="text-muted-foreground">{t('exposure.openInvoices')}</dt>
            <dd className="text-right tabular-nums">
              {money(e.open_invoices, locale, e.currency)}
            </dd>
            <dt className="text-muted-foreground">{t('exposure.openOrders')}</dt>
            <dd className="text-right tabular-nums">{money(e.open_orders, locale, e.currency)}</dd>
            <dt className="text-muted-foreground">{t('exposure.thisDocument')}</dt>
            <dd className="text-right tabular-nums">
              {risk ? money(risk.amount, locale, risk.currency) : ''}
            </dd>
            {after !== null && (
              <>
                <dt className="font-medium">{t('exposure.availableAfter')}</dt>
                <dd
                  className={
                    after.isNegative()
                      ? 'text-right font-medium text-danger tabular-nums'
                      : 'text-right font-medium tabular-nums'
                  }
                >
                  {money(after.toFixed(2), locale, e.currency)}
                </dd>
              </>
            )}
          </dl>
        )}
        {conflict ? (
          <VersionConflictAlert
            onReload={() => {
              issue.reset()
              onOpenChange(false)
              onReload()
            }}
          />
        ) : blocked ? (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-danger/40 bg-danger-soft p-3 text-sm text-danger-soft-foreground"
          >
            <p className="flex items-center gap-2 font-medium">
              <ShieldAlert className="size-4" aria-hidden="true" />
              {issue.error instanceof Error ? issue.error.message : t('issue.blocked')}
            </p>
            {breakdown && (
              <dl
                className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs"
                data-testid="credit-breakdown"
              >
                <dt>{t('exposure.limit')}</dt>
                <dd className="text-right tabular-nums">
                  {breakdown.limit === null
                    ? t('exposure.unlimited')
                    : money(breakdown.limit, locale, breakdown.currency)}
                </dd>
                <dt>{t('exposure.current')}</dt>
                <dd className="text-right tabular-nums">
                  {money(breakdown.exposure, locale, breakdown.currency)}
                </dd>
                <dt>{t('exposure.thisDocument')}</dt>
                <dd className="text-right tabular-nums">
                  {money(breakdown.document, locale, breakdown.currency)}
                </dd>
                <dt className="font-medium">{t('exposure.totalAfter')}</dt>
                <dd className="text-right font-medium tabular-nums">
                  {money(breakdown.total, locale, breakdown.currency)}
                </dd>
              </dl>
            )}
            {canOverride ? (
              <div className="space-y-1.5">
                <Label htmlFor="credit-override-reason">{t('issue.overrideReason')}</Label>
                <Textarea
                  id="credit-override-reason"
                  rows={2}
                  maxLength={500}
                  value={reason}
                  onChange={(ev) => setReason(ev.target.value)}
                />
              </div>
            ) : (
              <p className="text-xs">{t('issue.noOverride')}</p>
            )}
          </div>
        ) : (
          <ActionError error={issue.error} />
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('actions.cancel')}
          </Button>
          {blocked && canOverride ? (
            <Button
              type="button"
              variant="danger"
              disabled={busy || reason.trim().length < 3}
              onClick={() => issue.mutate({ override: reason.trim(), company: activeCompany() })}
            >
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              {t('issue.override')}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={busy || blocked || conflict}
              onClick={() => issue.mutate({ override: null, company: activeCompany() })}
            >
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              {t('issue.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
