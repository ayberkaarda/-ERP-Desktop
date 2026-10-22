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
import { errorMessage } from '@/features/sales/shared/lib/errors'
import { CurrencySelect } from '@/features/reference'
import { toIsoDate } from '@/lib/datetime'
import { isApiError, platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { requestsApi } from '../../shared/api'
import { PickLinesTable } from '../../shared/components/PickLinesTable'
import { SupplierList, type SupplierRef } from '../../shared/components/SupplierList'
import { SupplierExposureBadge, SupplierPicker } from '../../shared/components/SupplierPicker'
import { documentPath } from '../../shared/lib/chain'
import { decimalProblem, lineName, plain } from '../../shared/lib/forms'
import { invalidatePurchasing } from '../../shared/lib/keys'
import {
  conversionKeys,
  fulfilmentLines,
  openOnRequest,
  quantityProblem,
} from '../../shared/lib/lifecycle'
import type { PurchaseRequest, RequestToOrderInput, RequestToRfqInput } from '../../shared/types'

export type ConvertMode = 'rfq' | 'order'

interface RequestConvertDialogProps {
  request: PurchaseRequest
  mode: ConvertMode | null
  onClose: () => void
}

/** Request -> RFQ draft (suppliers to invite) or -> order draft (one supplier, prices). */
export function RequestConvertDialog({ request, mode, onClose }: RequestConvertDialogProps) {
  const [pending, setPending] = useState(false)
  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      {mode && (
        <Body
          key={mode}
          request={request}
          mode={mode}
          onClose={onClose}
          onPendingChange={setPending}
        />
      )}
    </Dialog>
  )
}

function Body({
  request,
  mode,
  onClose,
  onPendingChange,
}: {
  request: PurchaseRequest
  mode: ConvertMode
  onClose: () => void
  onPendingChange: (pending: boolean) => void
}) {
  const { t } = useTranslation('purchasing-orders')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const company = useCompanyStore((s) => s.activeCompanyId)
  const open = request.lines.filter((l) => openOnRequest(l).gt(0))
  // A single suggested supplier on every open line is the natural pick.
  const suggested = [...new Set(open.map((l) => l.suggested_supplier_id).filter(Boolean))]
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((l) => [l.id, openOnRequest(l).toString()])),
  )
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((l) => [l.id, plain(l.estimated_price)])),
  )
  const [documentDate, setDocumentDate] = useState(() => toIsoDate(new Date()))
  const [secondDate, setSecondDate] = useState(mode === 'order' ? (request.needed_by ?? '') : '')
  const [currency, setCurrency] = useState(mode === 'rfq' ? request.currency_code : '')
  const [suppliers, setSuppliers] = useState<SupplierRef[]>([])
  const [partyId, setPartyId] = useState(suggested.length === 1 ? (suggested[0] ?? '') : '')
  const [touched, setTouched] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})

  const problems = Object.fromEntries(
    open.map((l) => [l.id, quantityProblem(quantities[l.id] ?? '', openOnRequest(l))]),
  )
  const chosen = fulfilmentLines(quantities).map((c) => ({
    request_line_id: c.order_line_id,
    quantity: c.quantity,
  }))
  const priceProblem =
    mode === 'order' &&
    chosen.some((c) =>
      decimalProblem(prices[c.request_line_id] ?? '', { scale: 6, optional: true }),
    )
  const headerOk = mode === 'rfq' ? suppliers.length > 0 : partyId !== ''
  const valid =
    chosen.length > 0 &&
    Object.values(problems).every((p) => p === null) &&
    !priceProblem &&
    headerOk

  const build = (): RequestToRfqInput | RequestToOrderInput =>
    mode === 'rfq'
      ? {
          supplier_ids: suppliers.map((s) => s.id),
          document_date: documentDate,
          response_due: secondDate || null,
          currency_code: currency || null,
          warehouse_id: request.warehouse_id,
          notes: null,
          lines: chosen,
        }
      : {
          party_id: partyId,
          document_date: documentDate,
          expected_date: secondDate || null,
          currency_code: currency || null,
          warehouse_id: request.warehouse_id,
          notes: null,
          lines: chosen.map((c) => {
            const price = (prices[c.request_line_id] ?? '').trim()
            return price ? { ...c, unit_price: price } : c
          }),
        }

  const create = useMutation({
    mutationFn: async (input: RequestToRfqInput | RequestToOrderInput) => {
      const key = conversionKeys.keyFor({ company, mode, request: request.id, ...input })
      if (mode === 'rfq') {
        const r = await requestsApi.toRfq(request.id, input as RequestToRfqInput, key)
        return { id: r.document.id, type: 'purchase_rfq' as const }
      }
      const r = await requestsApi.toOrder(request.id, input as RequestToOrderInput, key)
      return { id: r.document.id, type: 'purchase_order' as const }
    },
    onSuccess: (doc, input) => {
      conversionKeys.release({ company, mode, request: request.id, ...input })
      invalidatePurchasing(queryClient, company ?? 'none')
      if (useCompanyStore.getState().activeCompanyId !== company) return
      platform.notify.success(t(`convert.${mode}.created`))
      onClose()
      void navigate(documentPath(doc.type, doc.id))
    },
    onError: (error, input) => {
      if (!isApiError(error)) return
      const mapped: Record<string, string> = {}
      for (const [field, messages] of Object.entries(error.fields)) {
        const m = /^lines\.(\d+)\.[a-z_]+$/.exec(field)
        const line = m ? input.lines[Number(m[1])] : undefined
        if (line && messages[0]) mapped[line.request_line_id] = messages[0]
      }
      setServerErrors(mapped)
    },
  })

  useEffect(() => {
    onPendingChange(create.isPending)
  }, [create.isPending, onPendingChange])
  useEffect(() => () => onPendingChange(false), [onPendingChange])

  const rows = open.map((l) => ({
    id: l.id,
    name: lineName(l),
    unit: l.unit_code ?? '',
    total: l.quantity,
    bound: openOnRequest(l),
  }))
  const unmapped = create.isError && Object.keys(serverErrors).length === 0

  return (
    <DialogContent
      closeLabel={t('wizard.close')}
      className="max-w-4xl"
      aria-busy={create.isPending}
    >
      <DialogHeader>
        <DialogTitle>{t(`convert.${mode}.title`, { number: request.number ?? '' })}</DialogTitle>
        <DialogDescription>{t(`convert.${mode}.description`)}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'rfq' ? (
            <FieldShell
              label={t('rfqs.suppliers')}
              required
              className="sm:col-span-2"
              error={
                touched && suppliers.length === 0 ? t('validation.suppliersRequired') : undefined
              }
            >
              {(control) => <SupplierList {...control} value={suppliers} onChange={setSuppliers} />}
            </FieldShell>
          ) : (
            <div className="space-y-1.5 sm:col-span-2">
              <FieldShell
                label={t('fields.supplier')}
                required
                error={touched && !partyId ? t('validation.supplier') : undefined}
              >
                {(control) => (
                  <SupplierPicker
                    {...control}
                    value={partyId}
                    onChange={(id) => setPartyId(id ?? '')}
                  />
                )}
              </FieldShell>
              {partyId && <SupplierExposureBadge partyId={partyId} />}
            </div>
          )}
          <FieldShell label={t('fields.documentDate')} required>
            {(control) => (
              <DateInput {...control} value={documentDate} onChange={setDocumentDate} />
            )}
          </FieldShell>
          <FieldShell label={mode === 'rfq' ? t('fields.responseDue') : t('fields.expectedDate')}>
            {(control) => <DateInput {...control} value={secondDate} onChange={setSecondDate} />}
          </FieldShell>
          <FieldShell
            label={t('fields.currency')}
            description={mode === 'order' ? t('convert.order.currencyHelp') : undefined}
          >
            {(control) => (
              <CurrencySelect
                {...control}
                value={currency || null}
                clearable={mode === 'order'}
                onChange={(v) => setCurrency(v ?? '')}
              />
            )}
          </FieldShell>
        </div>
        <PickLinesTable
          label={t('convert.linesLabel')}
          rows={rows}
          quantities={quantities}
          onQuantity={(id, v) => {
            setQuantities((prev) => ({ ...prev, [id]: v }))
            setServerErrors((prev) =>
              Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id)),
            )
          }}
          problems={problems}
          errors={serverErrors}
          touched={touched}
          {...(mode === 'order'
            ? {
                prices,
                onPrice: (id: string, v: string) => setPrices((prev) => ({ ...prev, [id]: v })),
                currency: currency || request.currency_code,
              }
            : {})}
        />
        {touched && chosen.length === 0 && (
          <p role="alert" className="text-sm text-danger">
            {t('wizard.nothingChosen')}
          </p>
        )}
        {unmapped && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(create.error, t('errors.action'))}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" disabled={create.isPending} onClick={onClose}>
          {t('actions.cancel')}
        </Button>
        <Button
          type="button"
          disabled={create.isPending}
          onClick={() => {
            setTouched(true)
            if (valid) create.mutate(build())
          }}
        >
          {create.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {t(`convert.${mode}.create`)}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
