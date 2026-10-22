import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateInput, DecimalInput, MoneyInput } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { errorMessage, isVersionConflict } from '@/features/sales/shared/lib/errors'
import { usePayloadKeys } from '@/features/sales/shared/lib/idempotency'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay, formatMoney } from '@/lib/money'
import { isApiError, platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { rfqsApi } from '../../shared/api'
import { isDecimal, lineName, trimDecimal } from '../../shared/lib/forms'
import { invalidatePurchasing, purchKeys } from '../../shared/lib/keys'
import {
  netPrice,
  quoteInput,
  quoteRowProblem,
  quoteRows,
  type QuoteRow,
} from '../../shared/lib/rfq'
import { TABLE } from '../../shared/lib/ui'
import type { PurchaseRfq, RfqSupplier } from '../../shared/types'

interface QuoteEntryDialogProps {
  rfq: PurchaseRfq
  supplier: RfqSupplier | null
  onClose: () => void
  onConflict: () => void
}

/** One supplier's prices per line (or a decline); replaces what was entered before. */
export function QuoteEntryDialog({ rfq, supplier, onClose, onConflict }: QuoteEntryDialogProps) {
  const [pending, setPending] = useState(false)
  return (
    <Dialog
      open={supplier !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      {supplier && (
        <Body
          key={supplier.party_id}
          rfq={rfq}
          supplier={supplier}
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
  supplier,
  onClose,
  onConflict,
  onPending,
}: {
  rfq: PurchaseRfq
  supplier: RfqSupplier
  onClose: () => void
  onConflict: () => void
  onPending: (pending: boolean) => void
}) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const company = useCompanyStore((s) => s.activeCompanyId)
  const [rows, setRows] = useState<QuoteRow[]>(() => quoteRows(rfq, supplier.party_id))
  const [declined, setDeclined] = useState(supplier.status === 'declined')
  const [touched, setTouched] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const problems = rows.map(quoteRowProblem)
  const priced = rows.filter((r) => r.unitPrice.trim() !== '')
  const valid = declined || (priced.length > 0 && problems.every((p) => p === null))

  const save = useMutation({
    mutationFn: async () => {
      const input = quoteInput(supplier.party_id, rows, declined, rfq.version)
      onPending(true)
      try {
        return await rfqsApi.quotes(rfq.id, input, keyFor({ quotes: rfq.id, ...input }))
      } finally {
        onPending(false)
      }
    },
    onSuccess: ({ document: doc }) => {
      keyFor.reset()
      const started = company ?? 'none'
      queryClient.setQueryData(purchKeys.detail('rfq', doc.id, started), (prev?: PurchaseRfq) =>
        prev ? { ...doc, links: prev.links, audit: prev.audit } : doc,
      )
      invalidatePurchasing(queryClient, started)
      platform.notify.success(declined ? t('rfqs.quotes.declinedSaved') : t('rfqs.quotes.saved'))
      onClose()
    },
    onError: (error) => {
      if (isVersionConflict(error)) {
        onClose()
        onConflict()
        return
      }
      if (!isApiError(error)) return
      // quotes.N.* is the N-th priced row of the body.
      const mapped: Record<string, string> = {}
      for (const [field, messages] of Object.entries(error.fields)) {
        const m = /^quotes\.(\d+)\./.exec(field)
        const row = m ? priced[Number(m[1])] : undefined
        if (row && messages[0]) mapped[row.rfqLineId] = messages[0]
      }
      setServerErrors(mapped)
    },
  })

  const update = (i: number, patch: Partial<QuoteRow>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const { th, thr, td, tdr } = TABLE
  const problemText = {
    price: t('validation.price'),
    discount: t('validation.discountPercent'),
    leadTime: t('validation.leadTime'),
  }

  return (
    <DialogContent closeLabel={t('wizard.close')} className="max-w-5xl" aria-busy={save.isPending}>
      <DialogHeader>
        <DialogTitle>{t('rfqs.quotes.title', { supplier: supplier.party_name })}</DialogTitle>
        <DialogDescription>
          {t('rfqs.quotes.description', { currency: rfq.currency_code })}
        </DialogDescription>
      </DialogHeader>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={declined} onChange={(e) => setDeclined(e.target.checked)} />
        <span>
          {t('rfqs.quotes.declined')}
          <span className="block text-xs text-muted-foreground">
            {t('rfqs.quotes.declinedHelp')}
          </span>
        </span>
      </label>
      {!declined && (
        <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
          <table
            aria-label={t('rfqs.quotes.linesLabel')}
            className="w-full border-separate border-spacing-0"
          >
            <thead className="sticky top-0 bg-surface-sunken text-muted-foreground">
              <tr>
                <th scope="col" className={th}>
                  {t('lines.item')}
                </th>
                <th scope="col" className={thr}>
                  {t('lines.quantity')}
                </th>
                <th scope="col" className={`${thr} w-36`}>
                  {t('lines.unitPrice')}
                </th>
                <th scope="col" className={`${thr} w-24`}>
                  {t('lines.discountPercent')}
                </th>
                <th scope="col" className={`${thr} w-24`}>
                  {t('rfqs.quotes.leadTime')}
                </th>
                <th scope="col" className={`${th} w-36`}>
                  {t('rfqs.quotes.validUntil')}
                </th>
                <th scope="col" className={thr}>
                  {t('rfqs.quotes.lineTotal')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rfq.lines.map((l, i) => {
                const row = rows[i]
                if (!row) return null
                const name = lineName(l)
                const problem = problems[i]
                const error =
                  serverErrors[l.id] ?? (touched && problem ? problemText[problem] : undefined)
                const id = `quote-${l.id}`
                const total = isDecimal(row.unitPrice)
                  ? netPrice(row.unitPrice, row.discountPercent || '0')
                      .mul(l.quantity)
                      .toFixed(2)
                  : null
                return (
                  <tr key={l.id}>
                    <td className={td}>{name}</td>
                    <td className={tdr}>
                      {formatDecimalDisplay(trimDecimal(l.quantity), {
                        locale,
                        minFraction: 0,
                        maxFraction: 6,
                      })}{' '}
                      {l.unit_code}
                    </td>
                    <td className={tdr}>
                      <MoneyInput
                        id={id}
                        aria-label={t('rfqs.quotes.priceFor', { item: name })}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${id}-error` : undefined}
                        scale={6}
                        displayMinFraction={2}
                        currency={rfq.currency_code}
                        value={row.unitPrice}
                        className="h-control-sm text-right"
                        onChange={(v) => update(i, { unitPrice: v })}
                      />
                      {error && (
                        <p id={`${id}-error`} className="pt-0.5 text-left text-2xs text-danger">
                          {error}
                        </p>
                      )}
                    </td>
                    <td className={tdr}>
                      <DecimalInput
                        aria-label={t('rfqs.quotes.discountFor', { item: name })}
                        scale={4}
                        displayMinFraction={0}
                        suffix="%"
                        value={row.discountPercent}
                        className="h-control-sm text-right"
                        onChange={(v) => update(i, { discountPercent: v })}
                      />
                    </td>
                    <td className={tdr}>
                      <Input
                        aria-label={t('rfqs.quotes.leadTimeFor', { item: name })}
                        inputMode="numeric"
                        value={row.leadTimeDays}
                        maxLength={4}
                        className="h-control-sm text-right"
                        onChange={(e) =>
                          update(i, { leadTimeDays: e.target.value.replace(/\D/g, '') })
                        }
                      />
                    </td>
                    <td className={td}>
                      <DateInput
                        aria-label={t('rfqs.quotes.validUntilFor', { item: name })}
                        value={row.validUntil}
                        className="h-control-sm"
                        onChange={(v) => update(i, { validUntil: v })}
                      />
                    </td>
                    <td className={tdr}>
                      {total ? formatMoney(total, rfq.currency_code, locale) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {touched && !declined && priced.length === 0 && (
        <p role="alert" className="text-sm text-danger">
          {t('rfqs.quotes.nothingPriced')}
        </p>
      )}
      {save.isError && Object.keys(serverErrors).length === 0 && !isVersionConflict(save.error) && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(save.error, t('errors.action'))}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" disabled={save.isPending} onClick={onClose}>
          {t('actions.cancel')}
        </Button>
        <Button
          type="button"
          disabled={save.isPending}
          onClick={() => {
            setTouched(true)
            if (valid) save.mutate()
          }}
        >
          {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {t('rfqs.quotes.save')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
