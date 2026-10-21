import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { DateInput, FieldShell, QuantityInput } from '@/components/shared/form'
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
import { WarehouseSelect } from '@/features/reference'
import { toIsoDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { isApiError, platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { ordersApi, type SalesOrder } from '../../shared/api'
import { errorMessage } from '../../shared/lib/errors'
import {
  fulfilmentKeys,
  fulfilmentLines,
  needsDeliverOnInvoice,
  quantityProblem,
  remainingFor,
  type FulfilmentMode,
} from '../../shared/lib/fulfilment'
import { documentPath } from '../../shared/lib/insights'
import { invalidateSales } from '../../shared/lib/keys'
import type { FulfilmentInput } from '../../shared/types'

interface FulfilmentWizardProps {
  order: SalesOrder
  mode: FulfilmentMode | null
  onClose: () => void
}

/** Opens the wizard only while `mode` is set; a new mode starts from fresh defaults. */
export function FulfilmentWizard({ order, mode, onClose }: FulfilmentWizardProps) {
  // While the document is being created the dialog cannot be dismissed.
  const [pending, setPending] = useState(false)
  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      {mode && (
        <WizardBody
          key={mode}
          order={order}
          mode={mode}
          onClose={onClose}
          onPendingChange={setPending}
        />
      )}
    </Dialog>
  )
}

/**
 * Two steps: quantities per order line (defaulting to what is left, bounded by the remaining
 * quantity and the over-delivery tolerance), then date / warehouse and a summary. Creates a
 * draft delivery or invoice and opens it.
 */
function WizardBody({
  order,
  mode,
  onClose,
  onPendingChange,
}: {
  order: SalesOrder
  mode: FulfilmentMode
  onClose: () => void
  onPendingChange: (pending: boolean) => void
}) {
  const { t } = useTranslation('sales-orders')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const company = useCompanyStore((s) => s.activeCompanyId)
  // null: the tolerance setting is not readable here, the server bounds the delivery.
  const overPercent = order.over_delivery_percent ?? null
  const offerDeliverOnInvoice = mode === 'invoice' && needsDeliverOnInvoice(order.lines)
  const [deliverOnInvoice, setDeliverOnInvoice] = useState(false)
  const bound = (line: SalesOrder['lines'][number], doi = deliverOnInvoice) =>
    remainingFor(mode, line, { overPercent, deliverOnInvoice: doi })
  const fill = (doi = deliverOnInvoice) =>
    Object.fromEntries(
      order.lines.map((l) => {
        // Default is what is left of the order, without the tolerance.
        const left = mode === 'delivery' ? remainingFor(mode, l) : bound(l, doi)
        return [l.id, left.gt(0) ? left.toString() : '']
      }),
    )
  const [step, setStep] = useState<1 | 2>(1)
  const [quantities, setQuantities] = useState<Record<string, string>>(() => fill())
  const [documentDate, setDocumentDate] = useState(() => toIsoDate(new Date()))
  const [warehouseId, setWarehouseId] = useState(order.warehouse_id ?? '')
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState(false)
  const qty = (v: string) => formatDecimalDisplay(v, { locale, minFraction: 0, maxFraction: 6 })

  const problems = Object.fromEntries(
    order.lines.map((l) => [l.id, quantityProblem(quantities[l.id] ?? '', bound(l))]),
  )
  const chosen = fulfilmentLines(quantities)
  const valid = chosen.length > 0 && Object.values(problems).every((p) => p === null)

  const create = useMutation({
    mutationFn: (input: FulfilmentInput) => {
      const key = fulfilmentKeys.keyFor({ company, mode, order: order.id, ...input })
      return mode === 'delivery'
        ? ordersApi.createDelivery(order.id, input, key)
        : ordersApi.createInvoice(order.id, input, key)
    },
    onSuccess: (doc, input) => {
      fulfilmentKeys.release({ company, mode, order: order.id, ...input })
      invalidateSales(queryClient, company ?? 'none')
      if (useCompanyStore.getState().activeCompanyId !== company) return
      platform.notify.success(t(`wizard.${mode}.created`, { number: doc.number ?? '' }))
      onClose()
      void navigate(documentPath(mode === 'delivery' ? 'sales_delivery' : 'sales_invoice', doc.id))
    },
    onError: (error, input) => {
      if (!isApiError(error)) return
      // lines.N.quantity refers to the N-th line of the body.
      const mapped: Record<string, string> = {}
      for (const [field, messages] of Object.entries(error.fields)) {
        const m = /^lines\.(\d+)\.(quantity|order_line_id)$/.exec(field)
        const line = m ? input.lines[Number(m[1])] : undefined
        if (line && messages[0]) mapped[line.order_line_id] = messages[0]
      }
      setServerErrors(mapped)
      if (Object.keys(mapped).length > 0) setStep(1)
    },
  })

  useEffect(() => {
    onPendingChange(create.isPending)
  }, [create.isPending, onPendingChange])
  useEffect(() => () => onPendingChange(false), [onPendingChange])

  const submit = () => {
    const input: FulfilmentInput = { document_date: documentDate, lines: chosen }
    if (mode === 'delivery') input.warehouse_id = warehouseId || null
    if (offerDeliverOnInvoice) input.deliver_on_invoice = deliverOnInvoice
    create.mutate(input)
  }

  const lineName = (l: SalesOrder['lines'][number]) =>
    [l.item_code, l.item_name].filter(Boolean).join(' · ')
  const th = 'h-row border-b border-border px-2 text-left text-xs font-medium whitespace-nowrap'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-2 py-1.5 align-top text-sm'
  const tdr = `${td} text-right tabular-nums`

  return (
    <DialogContent
      closeLabel={t('wizard.close')}
      className="max-w-4xl"
      aria-busy={create.isPending}
    >
      <DialogHeader>
        <DialogTitle>{t(`wizard.${mode}.title`, { number: order.number ?? '' })}</DialogTitle>
        <DialogDescription>
          {t('wizard.step', { step, total: 2 })} ·{' '}
          {step === 1 ? t('wizard.step1') : t('wizard.step2')}
        </DialogDescription>
      </DialogHeader>
      {step === 1 ? (
        <div className="space-y-3">
          {offerDeliverOnInvoice && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={deliverOnInvoice}
                onChange={(e) => {
                  setDeliverOnInvoice(e.target.checked)
                  setQuantities(fill(e.target.checked))
                }}
              />
              <span>
                {t('wizard.deliverOnInvoice')}
                <span className="block text-xs text-muted-foreground">
                  {t('wizard.deliverOnInvoiceHelp')}
                </span>
              </span>
            </label>
          )}
          {mode === 'delivery' && overPercent !== null && Number(overPercent) > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('wizard.tolerance', { percent: overPercent })}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setQuantities(fill())}
            >
              {t('wizard.fillAll')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setQuantities({})}>
              {t('wizard.clear')}
            </Button>
          </div>
          <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
            <table
              aria-label={t('wizard.linesLabel')}
              className="w-full border-separate border-spacing-0"
            >
              <thead className="sticky top-0 bg-surface-sunken text-muted-foreground">
                <tr>
                  <th scope="col" className={th}>
                    {t('wizard.item')}
                  </th>
                  <th scope="col" className={thr}>
                    {t('wizard.ordered')}
                  </th>
                  <th scope="col" className={thr}>
                    {t('wizard.delivered')}
                  </th>
                  <th scope="col" className={thr}>
                    {t('wizard.invoiced')}
                  </th>
                  <th scope="col" className={thr}>
                    {t('wizard.remaining')}
                  </th>
                  <th scope="col" className={`${thr} w-40`}>
                    {t(`wizard.${mode}.quantity`)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l) => {
                  const max = bound(l)
                  // Unknown tolerance: show what is left of the order, the server checks the rest.
                  const left = max.isFinite() ? max : remainingFor(mode, l)
                  const problem = problems[l.id]
                  const error =
                    serverErrors[l.id] ??
                    (touched || problem === 'exceeds'
                      ? problem === 'exceeds'
                        ? t('wizard.exceeds', { max: qty(max.toString()) })
                        : problem
                          ? t('wizard.invalid')
                          : undefined
                      : undefined)
                  const id = `wizard-${l.id}`
                  return (
                    <tr key={l.id}>
                      <td className={td}>
                        {lineName(l)}
                        {l.item_type === 'service' && (
                          <span className="ml-1 text-2xs text-muted-foreground">
                            {t('wizard.service')}
                          </span>
                        )}
                      </td>
                      <td className={tdr}>
                        {qty(l.quantity)} {l.unit_code}
                      </td>
                      <td className={tdr}>{qty(l.delivered_quantity)}</td>
                      <td className={tdr}>{qty(l.invoiced_quantity)}</td>
                      <td className={tdr}>{qty(left.toString())}</td>
                      <td className={tdr}>
                        <QuantityInput
                          id={id}
                          aria-label={t('wizard.quantityFor', { item: lineName(l) })}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? `${id}-error` : undefined}
                          scale={6}
                          value={quantities[l.id] ?? ''}
                          disabled={left.isZero() && max.isZero() && !(quantities[l.id] ?? '')}
                          className="h-control-sm text-right"
                          onChange={(v) => {
                            setQuantities((prev) => ({ ...prev, [l.id]: v }))
                            setServerErrors((prev) =>
                              Object.fromEntries(Object.entries(prev).filter(([k]) => k !== l.id)),
                            )
                          }}
                        />
                        {error && (
                          <p id={`${id}-error`} className="pt-0.5 text-left text-2xs text-danger">
                            {error}
                          </p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {touched && chosen.length === 0 && (
            <p role="alert" className="text-sm text-danger">
              {t('wizard.nothingChosen')}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldShell label={t('wizard.documentDate')} required>
              {(control) => (
                <DateInput {...control} value={documentDate} onChange={setDocumentDate} />
              )}
            </FieldShell>
            {mode === 'delivery' && (
              <FieldShell label={t('wizard.warehouse')}>
                {(control) => (
                  <WarehouseSelect
                    {...control}
                    value={warehouseId || null}
                    onChange={(v) => setWarehouseId(v ?? '')}
                  />
                )}
              </FieldShell>
            )}
          </div>
          <section
            aria-label={t('wizard.summary')}
            className="rounded-md border border-border p-3 text-sm"
          >
            <h3 className="pb-2 text-xs font-semibold">{t('wizard.summary')}</h3>
            <ul className="space-y-1">
              {chosen.map((c) => {
                const l = order.lines.find((x) => x.id === c.order_line_id)
                return (
                  <li key={c.order_line_id} className="flex justify-between gap-4">
                    <span>{l ? lineName(l) : c.order_line_id}</span>
                    <span className="tabular-nums">
                      {qty(c.quantity)} {l?.unit_code ?? ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
          {create.isError && Object.keys(serverErrors).length === 0 && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(create.error, t('wizard.failed'))}
            </p>
          )}
        </div>
      )}
      <DialogFooter>
        {step === 2 && (
          <Button
            type="button"
            variant="secondary"
            disabled={create.isPending}
            onClick={() => setStep(1)}
          >
            <ArrowLeft aria-hidden="true" />
            {t('wizard.back')}
          </Button>
        )}
        {step === 1 ? (
          <Button
            type="button"
            onClick={() => {
              setTouched(true)
              if (valid) setStep(2)
            }}
          >
            {t('wizard.next')}
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : (
          <Button type="button" disabled={create.isPending || !documentDate} onClick={submit}>
            {create.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {t(`wizard.${mode}.create`)}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  )
}
