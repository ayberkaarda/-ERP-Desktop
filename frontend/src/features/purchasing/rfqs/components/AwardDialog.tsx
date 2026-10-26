import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { DateInput, FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { errorMessage, isVersionConflict } from '@/features/sales/shared/lib/errors'
import { toIsoDate, useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { rfqsApi } from '../../shared/api'
import { documentPath, PURCH_PATHS } from '../../shared/lib/chain'
import { invalidatePurchasing } from '../../shared/lib/keys'
import { conversionKeys } from '../../shared/lib/lifecycle'
import { awardSummary, lowestPicks } from '../../shared/lib/rfq'
import type { AwardInput, PurchaseRfq, RfqComparison } from '../../shared/types'
import { ComparisonMatrix } from './ComparisonMatrix'

interface AwardDialogProps {
  rfq: PurchaseRfq
  comparison: RfqComparison | undefined
  open: boolean
  onClose: () => void
  onConflict: () => void
}

/** Award the whole RFQ to one supplier or each line to a supplier; one draft order per supplier. */
export function AwardDialog({ rfq, comparison, open, onClose, onConflict }: AwardDialogProps) {
  const [pending, setPending] = useState(false)
  return (
    <Dialog
      open={open && comparison !== undefined}
      onOpenChange={(o) => {
        if (!o && !pending) onClose()
      }}
    >
      {open && comparison && (
        <Body
          rfq={rfq}
          comparison={comparison}
          onClose={onClose}
          onConflict={onConflict}
          onPending={setPending}
        />
      )}
    </Dialog>
  )
}

function Body({
  rfq,
  comparison,
  onClose,
  onConflict,
  onPending,
}: {
  rfq: PurchaseRfq
  comparison: RfqComparison
  onClose: () => void
  onConflict: () => void
  onPending: (pending: boolean) => void
}) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const company = useCompanyStore((s) => s.activeCompanyId)
  const quoting = comparison.suppliers.filter((s) => s.lines_quoted > 0)
  const [mode, setMode] = useState<'supplier' | 'lines'>('supplier')
  const [partyId, setPartyId] = useState(
    comparison.lowest_total_party_id ?? quoting[0]?.party_id ?? '',
  )
  const [picks, setPicks] = useState<Record<string, string>>(() => lowestPicks(comparison))
  const [documentDate, setDocumentDate] = useState(() => toIsoDate(new Date()))
  const [expectedDate, setExpectedDate] = useState('')

  const input: AwardInput =
    mode === 'supplier'
      ? {
          party_id: partyId,
          document_date: documentDate,
          expected_date: expectedDate || null,
          warehouse_id: rfq.warehouse_id,
          version: rfq.version,
        }
      : {
          lines: Object.entries(picks).map(([rfq_line_id, party_id]) => ({
            rfq_line_id,
            party_id,
          })),
          document_date: documentDate,
          expected_date: expectedDate || null,
          warehouse_id: rfq.warehouse_id,
          version: rfq.version,
        }
  const summary =
    mode === 'supplier'
      ? awardSummary(
          comparison,
          Object.fromEntries(comparison.lines.map((l) => [l.rfq_line_id, partyId])),
        )
      : awardSummary(comparison, picks)
  const valid = summary.length > 0 && documentDate !== ''

  const award = useMutation({
    mutationFn: () =>
      rfqsApi.award(rfq.id, input, conversionKeys.keyFor({ company, award: rfq.id, ...input })),
    onSuccess: (result) => {
      conversionKeys.release({ company, award: rfq.id, ...input })
      invalidatePurchasing(queryClient, company ?? 'none')
      if (useCompanyStore.getState().activeCompanyId !== company) return
      platform.notify.success(
        t('rfqs.award.done', {
          count: result.orders.length,
          suppliers: result.orders.map((o) => o.party_name).join(', '),
        }),
      )
      onClose()
      const first = result.orders[0]
      void navigate(
        result.orders.length === 1 && first
          ? documentPath('purchase_order', first.id)
          : `${PURCH_PATHS.order}?filter[status]=draft`,
      )
    },
    onError: (error) => {
      if (isVersionConflict(error)) {
        onClose()
        onConflict()
      }
    },
  })

  useEffect(() => {
    onPending(award.isPending)
  }, [award.isPending, onPending])
  useEffect(() => () => onPending(false), [onPending])

  return (
    <DialogContent closeLabel={t('wizard.close')} className="max-w-6xl" aria-busy={award.isPending}>
      <DialogHeader>
        <DialogTitle>{t('rfqs.award.title', { number: rfq.number ?? '' })}</DialogTitle>
        <DialogDescription>{t('rfqs.award.description')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">{t('rfqs.award.mode')}</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="award-mode"
              checked={mode === 'supplier'}
              onChange={() => setMode('supplier')}
            />
            {t('rfqs.award.wholeSupplier')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="award-mode"
              checked={mode === 'lines'}
              onChange={() => setMode('lines')}
            />
            {t('rfqs.award.perLine')}
          </label>
        </fieldset>
        {mode === 'supplier' ? (
          <fieldset className="space-y-1.5 text-sm">
            <legend className="pb-1 text-xs font-semibold">{t('rfqs.award.supplier')}</legend>
            {quoting.map((s) => (
              <label key={s.party_id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="award-supplier"
                  checked={partyId === s.party_id}
                  onChange={() => setPartyId(s.party_id)}
                />
                <span>{s.party_name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {s.total ? formatMoney(s.total, comparison.currency_code, locale) : '—'} ·{' '}
                  {s.complete
                    ? t('rfqs.comparison.complete')
                    : t('rfqs.comparison.partial', {
                        quoted: s.lines_quoted,
                        total: comparison.lines.length,
                      })}
                </span>
                {comparison.lowest_total_party_id === s.party_id && (
                  <span className="text-xs text-success">{t('rfqs.award.lowestTotal')}</span>
                )}
              </label>
            ))}
          </fieldset>
        ) : (
          <ComparisonMatrix
            comparison={comparison}
            lines={rfq.lines}
            picks={picks}
            onPick={(lineId, party) => setPicks((prev) => ({ ...prev, [lineId]: party }))}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldShell label={t('fields.documentDate')} required>
            {(control) => (
              <DateInput {...control} value={documentDate} onChange={setDocumentDate} />
            )}
          </FieldShell>
          <FieldShell label={t('fields.expectedDate')} description={t('rfqs.award.expectedHelp')}>
            {(control) => (
              <DateInput {...control} value={expectedDate} onChange={setExpectedDate} />
            )}
          </FieldShell>
        </div>
        <section
          aria-label={t('rfqs.award.summary')}
          className="rounded-md border border-border p-3 text-sm"
        >
          <h3 className="pb-2 text-xs font-semibold">{t('rfqs.award.summary')}</h3>
          <ul className="space-y-1">
            {summary.map((s) => (
              <li key={s.party_id} className="flex justify-between gap-4">
                <span>{t('rfqs.award.orderFor', { supplier: s.party_name, count: s.lines })}</span>
                <span className="tabular-nums">
                  {formatMoney(s.total, comparison.currency_code, locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
        {award.isError && !isVersionConflict(award.error) && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(award.error, t('errors.action'))}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" disabled={award.isPending} onClick={onClose}>
          {t('actions.cancel')}
        </Button>
        <Button type="button" disabled={award.isPending || !valid} onClick={() => award.mutate()}>
          {award.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {t('rfqs.award.create', { count: summary.length })}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
