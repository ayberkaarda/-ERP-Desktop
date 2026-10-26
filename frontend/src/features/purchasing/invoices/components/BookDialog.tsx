import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BookCheck, Loader2, ShieldAlert, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ActionError } from '@/features/sales/invoices/kit/components/ActionError'
import { money } from '@/features/sales/invoices/kit/money'
import { VersionConflictAlert } from '@/features/sales/shared/components/common'
import { useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { invoicesApi, type BookResult } from '../api'
import { isMatchFailed, isVersionConflict, matchFailureDetails } from '../kit/http'
import { activeCompany, invalidatePurchEffects, purchKeys } from '../kit/keys'
import { PURCH_PERMS } from '../kit/permissions'
import { bookKeys, OVERRIDE_MIN } from '../lib/bookKeys'
import { bookingOutcome, parseMatch, type MatchResult } from '../lib/match'
import { useInvoiceMatch } from '../queries'
import type { BookInput, Invoice } from '../types'
import { MatchPanel } from './MatchPanel'

interface BookDialogProps {
  invoice: Invoice
  open: boolean
  onOpenChange: (open: boolean) => void
  onBooked: (result: BookResult) => void
  onReload: () => void
}

/**
 * POST /purchase-invoices/{id}/book {version, match_override_reason?}: shows the live three-way
 * match first. Warn mode books with a note; block mode needs purchasing.match_override and a
 * reason; a 422 purchasing.match_failed shows the server's breakdown.
 */
export function BookDialog({ invoice, open, onOpenChange, onBooked, onReload }: BookDialogProps) {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  const queryClient = useQueryClient()
  const canOverride = usePermission(PURCH_PERMS.matchOverride)
  const live = useInvoiceMatch(invoice.id, open)
  // A 422 match breakdown belongs to the version it refused and to the match read before it:
  // a newer version, a fresher live match or reopening the dialog drops it.
  const [refusal, setRefusal] = useState<{
    version: number
    liveAt: number
    match: MatchResult | null
  } | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) setRefusal(null)
  }
  const refusedNow =
    refusal !== null && refusal.version === invoice.version && live.dataUpdatedAt <= refusal.liveAt
  const refused = refusedNow ? refusal.match : null
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const match = refused ?? live.data ?? invoice.match
  const outcome = refusedNow ? 'block' : bookingOutcome(match)
  const needsReason = outcome === 'block'
  const reasonShort = reason.trim().length < OVERRIDE_MIN
  const missingNumber = !invoice.supplier_invoice_no

  const mutation = useMutation({
    mutationFn: ({ body }: { body: BookInput; company: string }) =>
      invoicesApi.book(invoice.id, body, bookKeys.keyFor({ id: invoice.id, ...body })),
    onSuccess: (result, { body, company }) => {
      bookKeys.release({ id: invoice.id, ...body })
      queryClient.setQueryData(
        purchKeys.detail('invoices', result.invoice.id, company),
        result.invoice,
      )
      invalidatePurchEffects(queryClient, company)
      if (activeCompany() !== company) return
      for (const w of result.warnings) platform.notify.warning(w.message)
      setReason('')
      setTouched(false)
      setRefusal(null)
      onOpenChange(false)
      onBooked(result)
    },
    onError: (error) => {
      const details = matchFailureDetails(error)
      if (details)
        setRefusal({
          version: invoice.version,
          liveAt: live.dataUpdatedAt,
          match: parseMatch(details),
        })
    },
  })
  const conflict = isVersionConflict(mutation.error)
  const blockedWithoutRight = needsReason && !canOverride

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setTouched(true)
    if (blockedWithoutRight || (needsReason && reasonShort)) return
    const body: BookInput = { version: invoice.version }
    if (needsReason) body.match_override_reason = reason.trim()
    mutation.mutate({ body, company: activeCompany() })
  }

  const close = (next: boolean) => {
    if (mutation.isPending) return
    if (!next) {
      setTouched(false)
      setRefusal(null)
      mutation.reset()
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        closeLabel={t('actions.close')}
        className="max-w-4xl"
        aria-busy={mutation.isPending}
      >
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('book.title')}</DialogTitle>
            <DialogDescription>{t('book.body')}</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">{t('fields.supplierInvoiceNo')}</dt>
              <dd className="font-code">{invoice.supplier_invoice_no ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('totals.total')}</dt>
              <dd className="tabular-nums">
                {money(invoice.total, locale, invoice.currency_code)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('totals.withholding')}</dt>
              <dd className="tabular-nums">
                {money(invoice.withholding_total, locale, invoice.currency_code)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('totals.payable')}</dt>
              <dd className="font-semibold tabular-nums" data-testid="book-payable">
                {money(invoice.payable_total, locale, invoice.currency_code)}
              </dd>
            </div>
          </dl>
          {missingNumber && (
            <p role="alert" className="flex gap-2 text-sm text-danger">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t('book.numberRequired')}
            </p>
          )}
          <MatchPanel match={match} lines={invoice.lines} loading={live.isFetching} live />
          {outcome === 'warn' && (
            <p
              role="status"
              className="rounded-md bg-warning-soft p-2 text-sm text-warning-soft-foreground"
            >
              {t('book.warnMode')}
            </p>
          )}
          {needsReason && (
            <div
              className="space-y-2 rounded-md border border-danger/40 p-3"
              data-testid="override"
            >
              <p className="flex items-start gap-2 text-sm">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                {canOverride ? t('book.blockOverride') : t('book.blockNoRight')}
              </p>
              {canOverride && (
                <FieldShell
                  label={t('book.overrideReason')}
                  required
                  error={
                    touched && reasonShort
                      ? t('book.reasonShort', { min: OVERRIDE_MIN })
                      : undefined
                  }
                >
                  {(control) => (
                    <Textarea
                      {...control}
                      value={reason}
                      rows={3}
                      maxLength={1000}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  )}
                </FieldShell>
              )}
            </div>
          )}
          {conflict ? (
            <VersionConflictAlert
              onReload={() => {
                mutation.reset()
                onOpenChange(false)
                onReload()
              }}
            />
          ) : (
            !isMatchFailed(mutation.error) && <ActionError error={mutation.error} />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => close(false)}
            >
              {t('actions.cancel')}
            </Button>
            <Button
              type="submit"
              variant={needsReason ? 'danger' : 'primary'}
              disabled={mutation.isPending || conflict || blockedWithoutRight}
            >
              {mutation.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <BookCheck aria-hidden="true" />
              )}
              {needsReason ? t('book.confirmOverride') : t('book.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
