import { useMutation, useQueryClient } from '@tanstack/react-query'
import Decimal from 'decimal.js'
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
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/features/sales/shared/lib/errors'
import { WarehouseSelect } from '@/features/reference'
import { toIsoDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { isApiError, platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { ordersApi } from '../../shared/api'
import { documentPath } from '../../shared/lib/chain'
import { lineName } from '../../shared/lib/forms'
import { invalidatePurchasing } from '../../shared/lib/keys'
import {
  fulfilmentLines,
  needsReceiveOnInvoice,
  quantityProblem,
  unreceivedQuantity,
  wizardBound,
  wizardKeys,
  type WizardMode,
} from '../../shared/lib/lifecycle'
import { TABLE } from '../../shared/lib/ui'
import type {
  InvoiceFromOrderInput,
  OrderLine,
  PurchaseOrder,
  ReceiptFromOrderInput,
} from '../../shared/types'

interface OrderWizardProps {
  order: PurchaseOrder
  mode: WizardMode | null
  /** purchasing.allow_over_receipt_percent when readable; null = the server bounds receipts. */
  overReceiptPercent: string | null
  onClose: () => void
}

/** Opens only while `mode` is set; a new mode starts from fresh defaults. */
export function OrderWizard({ order, mode, overReceiptPercent, onClose }: OrderWizardProps) {
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
          overReceiptPercent={overReceiptPercent}
          onClose={onClose}
          onPendingChange={setPending}
        />
      )}
    </Dialog>
  )
}

/**
 * Step 1: quantities per order line, defaulting to what is left and bounded by the remaining
 * quantity (receipts: plus the over-receipt tolerance; invoices: what was received unless the
 * invoice receives the goods). Step 2: date, warehouse or supplier invoice number, and a summary.
 * Creates a draft receipt or invoice (Idempotency-Key kept across retries) and opens it.
 */
function WizardBody({
  order,
  mode,
  overReceiptPercent,
  onClose,
  onPendingChange,
}: {
  order: PurchaseOrder
  mode: WizardMode
  overReceiptPercent: string | null
  onClose: () => void
  onPendingChange: (pending: boolean) => void
}) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const company = useCompanyStore((s) => s.activeCompanyId)
  const offerReceive = mode === 'invoice' && needsReceiveOnInvoice(order.lines)
  const [receiveOnInvoice, setReceiveOnInvoice] = useState(false)
  const bound = (l: OrderLine, roi = receiveOnInvoice) =>
    wizardBound(mode, l, overReceiptPercent, roi)
  const fill = (roi = receiveOnInvoice) =>
    Object.fromEntries(
      order.lines.map((l) => {
        // The default is what is left of the order, without the tolerance.
        const left = mode === 'receipt' ? unreceivedQuantity(l) : bound(l, roi)
        return [l.id, left.gt(0) ? left.toString() : '']
      }),
    )
  const [step, setStep] = useState<1 | 2>(1)
  const [quantities, setQuantities] = useState<Record<string, string>>(() => fill())
  const [documentDate, setDocumentDate] = useState(() => toIsoDate(new Date()))
  const [warehouseId, setWarehouseId] = useState(order.warehouse_id ?? '')
  const [supplierNo, setSupplierNo] = useState('')
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState(false)
  const qty = (v: string) => formatDecimalDisplay(v, { locale, minFraction: 0, maxFraction: 6 })

  const problems = Object.fromEntries(
    order.lines.map((l) => [l.id, quantityProblem(quantities[l.id] ?? '', bound(l))]),
  )
  const chosen = fulfilmentLines(quantities)
  const valid = chosen.length > 0 && Object.values(problems).every((p) => p === null)

  const create = useMutation({
    mutationFn: (input: ReceiptFromOrderInput | InvoiceFromOrderInput) => {
      const key = wizardKeys.keyFor({ company, mode, order: order.id, ...input })
      return mode === 'receipt'
        ? ordersApi.createReceipt(order.id, input as ReceiptFromOrderInput, key)
        : ordersApi.createInvoice(order.id, input as InvoiceFromOrderInput, key)
    },
    onSuccess: (doc, input) => {
      wizardKeys.release({ company, mode, order: order.id, ...input })
      invalidatePurchasing(queryClient, company ?? 'none')
      if (useCompanyStore.getState().activeCompanyId !== company) return
      platform.notify.success(t(`wizard.${mode}.created`, { number: doc.number ?? '' }))
      onClose()
      void navigate(
        documentPath(mode === 'receipt' ? 'purchase_receipt' : 'purchase_invoice', doc.id),
      )
    },
    onError: (error, input) => {
      if (!isApiError(error)) return
      // lines.N.quantity refers to the N-th line of the body.
      const mapped: Record<string, string> = {}
      for (const [field, messages] of Object.entries(error.fields)) {
        const m = /^lines\.(\d+)\.(quantity|order_line_id|unit_price)$/.exec(field)
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
    if (mode === 'receipt') {
      create.mutate({
        document_date: documentDate,
        warehouse_id: warehouseId || null,
        supplier_reference: null,
        notes: null,
        lines: chosen,
      })
    } else {
      create.mutate({
        document_date: documentDate,
        due_date: null,
        supplier_invoice_no: supplierNo.trim() || null,
        receive_on_invoice: offerReceive && receiveOnInvoice,
        notes: null,
        lines: chosen,
      })
    }
  }

  const { th, thr, td, tdr } = TABLE

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
          {offerReceive && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={receiveOnInvoice}
                onChange={(e) => {
                  setReceiveOnInvoice(e.target.checked)
                  setQuantities(fill(e.target.checked))
                }}
              />
              <span>
                {t('wizard.receiveOnInvoice')}
                <span className="block text-xs text-muted-foreground">
                  {t('wizard.receiveOnInvoiceHelp')}
                </span>
              </span>
            </label>
          )}
          {mode === 'receipt' &&
            overReceiptPercent !== null &&
            new Decimal(overReceiptPercent).gt(0) && (
              <p className="text-xs text-muted-foreground">
                {t('wizard.tolerance', { percent: overReceiptPercent })}
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
                    {t('lines.item')}
                  </th>
                  <th scope="col" className={thr}>
                    {t('lines.ordered')}
                  </th>
                  <th scope="col" className={thr}>
                    {t('lines.received')}
                  </th>
                  <th scope="col" className={thr}>
                    {t('lines.invoiced')}
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
                  const left = max.isFinite() ? max : unreceivedQuantity(l)
                  const problem = problems[l.id]
                  const error =
                    serverErrors[l.id] ??
                    (problem === 'exceeds'
                      ? t('wizard.exceeds', { max: qty(max.toString()) })
                      : touched && problem
                        ? t('wizard.invalid')
                        : undefined)
                  const id = `wizard-${l.id}`
                  const name = lineName(l)
                  return (
                    <tr key={l.id}>
                      <td className={td}>
                        {name}
                        {l.item_type === 'service' && (
                          <span className="ml-1 text-2xs text-muted-foreground">
                            {t('wizard.service')}
                          </span>
                        )}
                      </td>
                      <td className={tdr}>
                        {qty(l.quantity)} {l.unit_code}
                      </td>
                      <td className={tdr}>{qty(l.received_quantity)}</td>
                      <td className={tdr}>{qty(l.invoiced_quantity)}</td>
                      <td className={tdr} data-testid={`remaining-${l.id}`}>
                        {qty(left.toString())}
                      </td>
                      <td className={tdr}>
                        <QuantityInput
                          id={id}
                          aria-label={t('wizard.quantityFor', { item: name })}
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
            {mode === 'receipt' ? (
              <FieldShell label={t('fields.warehouse')}>
                {(control) => (
                  <WarehouseSelect
                    {...control}
                    value={warehouseId || null}
                    onChange={(v) => setWarehouseId(v ?? '')}
                  />
                )}
              </FieldShell>
            ) : (
              <FieldShell
                label={t('wizard.supplierInvoiceNo')}
                description={t('wizard.supplierInvoiceNoHelp')}
              >
                {(control) => (
                  <Input
                    {...control}
                    value={supplierNo}
                    maxLength={64}
                    onChange={(e) => setSupplierNo(e.target.value)}
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
