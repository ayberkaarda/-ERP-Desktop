import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, CopyPlus, FileCheck2, Loader2, Send, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { quotesApi, type SalesQuote } from '../../shared/api'
import { ReasonDialog } from '../../shared/components/ReasonDialog'
import { notifyWarnings } from '../../shared/lib/notify'
import { errorMessage, isVersionConflict } from '../../shared/lib/errors'
import { usePayloadKeys } from '../../shared/lib/idempotency'
import { SALES_PATHS } from '../../shared/lib/insights'
import { invalidateSales, salesKeys } from '../../shared/lib/keys'
import { quoteActions } from '../../shared/lib/lifecycle'
import { SALES_ACCESS } from '../../shared/permissions'

type Step = 'send' | 'accept' | 'reject' | 'convert' | 'revise'

interface QuoteActionsProps {
  quote: SalesQuote
  /** Saves pending edits of a draft first (editor); read-only pages pass the quote itself. */
  ensureSaved?: () => Promise<SalesQuote | null>
  onConflict: () => void
  busy?: boolean
  /** After a state change of this quote (the page leaves the editor). */
  onDone?: () => void
}

/** Lifecycle buttons of a quote: send, accept, reject (with reason), convert to order, revise. */
export function QuoteActions({
  quote,
  ensureSaved,
  onConflict,
  busy = false,
  onDone,
}: QuoteActionsProps) {
  const { t } = useTranslation('sales-quotes')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const company = useCompanyStore((s) => s.activeCompanyId)
  const canState = usePermission(SALES_ACCESS.quoteState)
  const canConvert = usePermission(SALES_ACCESS.quoteConvert)
  const canRevise = usePermission(SALES_ACCESS.quoteRevise)
  const [confirming, setConfirming] = useState<Exclude<Step, 'reject'> | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const allowed = quoteActions(quote.status)

  const run = useMutation({
    mutationFn: async ({
      step,
      target,
      reason,
    }: {
      step: Step
      target: SalesQuote
      reason?: string
    }) => {
      const payload = { step, id: target.id, version: target.version, reason }
      const key = keyFor(payload)
      switch (step) {
        case 'send':
        case 'accept':
          return {
            kind: 'quote' as const,
            ...(await quotesApi.transition(target.id, step, target.version, key)),
          }
        case 'reject':
          return {
            kind: 'quote' as const,
            ...(await quotesApi.reject(target.id, target.version, reason ?? '', key)),
          }
        case 'revise':
          return {
            kind: 'revision' as const,
            ...(await quotesApi.revise(target.id, target.version, key)),
          }
        case 'convert':
          return {
            kind: 'order' as const,
            ...(await quotesApi.convert(target.id, target.version, key)),
          }
      }
    },
    onSuccess: (result, { step }) => {
      keyFor.reset()
      const started = company ?? 'none'
      invalidateSales(queryClient, started)
      if (useCompanyStore.getState().activeCompanyId !== company) return
      notifyWarnings(result.warnings)
      if (result.kind === 'order') {
        platform.notify.success(t('actions.converted', { number: result.document.number ?? '' }))
        void navigate(`${SALES_PATHS.order}/${result.document.id}`)
        return
      }
      if (result.kind === 'revision') {
        platform.notify.success(t('actions.revised', { revision: result.document.revision }))
        void navigate(`${SALES_PATHS.quote}/${result.document.id}`)
        return
      }
      queryClient.setQueryData(
        salesKeys.detail('quote', result.document.id, started),
        result.document,
      )
      platform.notify.success(t(`actions.done.${step}`))
      onDone?.()
    },
    onError: (error) => {
      if (isVersionConflict(error)) onConflict()
      else platform.notify.error(errorMessage(error, t('actions.failed')))
    },
  })

  const perform = async (step: Step, reason?: string) => {
    const target = ensureSaved ? await ensureSaved() : quote
    // Validation or save errors are shown in the form; the dialog closes.
    if (!target) return
    await run.mutateAsync({ step, target, reason })
  }

  const pending = busy || run.isPending
  const button = (step: Exclude<Step, 'reject'>, icon: typeof Send, primary = false) => {
    const Icon = icon
    return (
      <Button
        key={step}
        type="button"
        variant={primary ? 'primary' : 'secondary'}
        disabled={pending}
        onClick={() => setConfirming(step)}
      >
        {run.isPending && run.variables.step === step ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Icon aria-hidden="true" />
        )}
        {t(`actions.${step}`)}
      </Button>
    )
  }

  return (
    <>
      {canState && allowed.includes('send') && button('send', Send, true)}
      {canState && allowed.includes('reject') && (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setRejecting(true)}
        >
          <X aria-hidden="true" />
          {t('actions.reject')}
        </Button>
      )}
      {canState && allowed.includes('accept') && button('accept', Check)}
      {canRevise && allowed.includes('revise') && button('revise', CopyPlus)}
      {canConvert && allowed.includes('convert') && button('convert', FileCheck2, true)}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        tone="primary"
        title={confirming ? t(`confirm.${confirming}.title`) : undefined}
        description={
          confirming ? t(`confirm.${confirming}.body`, { number: quote.number ?? '' }) : undefined
        }
        confirmLabel={confirming ? t(`actions.${confirming}`) : undefined}
        onConfirm={async () => {
          if (confirming) await perform(confirming)
        }}
      />
      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={t('confirm.reject.title')}
        description={t('confirm.reject.body', { number: quote.number ?? '' })}
        label={t('confirm.reject.reason')}
        confirmLabel={t('actions.reject')}
        tone="danger"
        onConfirm={(reason) => perform('reject', reason)}
      />
    </>
  )
}
