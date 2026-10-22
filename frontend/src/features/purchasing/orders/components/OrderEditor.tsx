import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save, Trash2, X } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useForm, useFormState, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import {
  DateInput,
  DecimalInput,
  Form,
  FormErrorSummary,
  FormField,
} from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WarningsList } from '@/features/sales/shared/components/TotalsPanel'
import { errorMessage, isVersionConflict } from '@/features/sales/shared/lib/errors'
import { usePayloadKeys } from '@/features/sales/shared/lib/idempotency'
import { CurrencySelect, PaymentTermSelect, WarehouseSelect } from '@/features/reference'
import { toIsoDate } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { ordersApi, type ActionResult } from '../../shared/api'
import { PurchStatusBadge, VersionConflictAlert } from '../../shared/components/common'
import { SupplierExposureBadge, SupplierPicker } from '../../shared/components/SupplierPicker'
import { PurchTotals } from '../../shared/components/Totals'
import { useCompanyCurrency, usePreviewTotals } from '../../shared/hooks/queries'
import { PURCH_PATHS } from '../../shared/lib/chain'
import { invalidatePurchasing, purchKeys } from '../../shared/lib/keys'
import { notifyWarnings } from '../../shared/lib/notify'
import {
  emptyOrderValues,
  orderFieldMapper,
  orderLinesUnchanged,
  orderPreviewInput,
  orderSchema,
  orderToInput,
  orderToValues,
  type OrderMessages,
  type OrderValues,
} from '../../shared/lib/orderForm'
import { PURCH_PERMS } from '../../shared/permissions'
import {
  MAX_LINES,
  type PreviewLine,
  type PurchaseOrder,
  type PurchaseWarning,
} from '../../shared/types'
import { OrderLinesGrid } from './OrderLinesGrid'

export interface EditorActionContext {
  /** The stored draft; unsaved edits are saved first (null when validation or saving failed). */
  ensureSaved: () => Promise<PurchaseOrder | null>
  busy: boolean
}

interface OrderEditorProps {
  /** null for a new order. */
  document: PurchaseOrder | null
  /** revise = an approved / sent / pending order rewritten through POST /revise. */
  mode?: 'draft' | 'revise'
  onReload: () => Promise<PurchaseOrder | undefined>
  onRevised?: (doc: PurchaseOrder) => void
  onCancelRevise?: () => void
  actions?: (ctx: EditorActionContext) => ReactNode
}

/**
 * Purchase order editor: supplier (with exposure), dates, currency and rate, payment term,
 * warehouse, supplier reference; lines with server totals incl. withholding (debounced preview);
 * save draft (POST with Idempotency-Key, PATCH with version), delete, and revise.
 */
export function OrderEditor({
  document,
  mode = 'draft',
  onReload,
  onRevised,
  onCancelRevise,
  actions,
}: OrderEditorProps) {
  const { t } = useTranslation('purchasing-orders')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const company = useCompanyStore((s) => s.activeCompanyId)
  const canCreate = usePermission(PURCH_PERMS.orders.create)
  const canUpdate = usePermission(PURCH_PERMS.orders.update)
  const canDelete = usePermission(PURCH_PERMS.orders.delete)
  // The revise endpoint is authorised by approve (OrderPolicy), not by update.
  const canApprove = usePermission(PURCH_PERMS.orders.approve)
  const revising = mode === 'revise'
  const canEdit = revising ? canApprove : document ? canUpdate : canCreate
  const companyCurrency = useCompanyCurrency()
  const [base, setBase] = useState<PurchaseOrder | null>(document)
  const [conflict, setConflict] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lastValues, setLastValues] = useState<OrderValues | null>(null)

  const messages: OrderMessages = useMemo(
    () => ({
      party: t('validation.supplier'),
      currency: t('validation.currency'),
      minLines: t('validation.minLines'),
      maxLines: t('validation.maxLines', { max: MAX_LINES }),
      item: t('validation.item'),
      unit: t('validation.unit'),
      quantity: t('validation.quantity'),
      price: t('validation.price'),
      discountPercent: t('validation.discountPercent'),
      discountAmount: t('validation.discountAmount'),
      fxRate: t('validation.fxRate'),
      expectedDate: t('validation.expectedDate'),
    }),
    [t],
  )
  const form = useForm<OrderValues>({
    resolver: zodResolver(orderSchema(messages)),
    defaultValues: document
      ? orderToValues(document)
      : emptyOrderValues(toIsoDate(new Date()), companyCurrency),
  })
  const { isDirty } = useFormState({ control: form.control })
  const values = useWatch({ control: form.control }) as OrderValues
  // An unchanged stored order shows what is stored; the preview runs once something changed.
  const pristine = base !== null && !isDirty
  const preview = usePreviewTotals(pristine ? null : orderPreviewInput(values))
  const previewByKey = useMemo(
    () =>
      new Map<string, PreviewLine>(
        pristine
          ? base.lines.map((l) => [
              l.id,
              {
                key: l.id,
                unit_price: l.unit_price,
                price_source: l.price_source,
                base_quantity: l.base_quantity,
                net_amount: l.net_amount,
                tax_code_id: l.tax_code_id,
                tax_rate: l.tax_rate,
                tax_amount: l.tax_amount,
                withholding_amount: l.withholding_amount,
                line_total: l.line_total,
              },
            ])
          : (preview.data?.lines ?? []).map((l) => [l.key, l]),
      ),
    [pristine, base, preview.data],
  )

  const changedElsewhere =
    document !== null &&
    base !== null &&
    document.id === base.id &&
    document.version !== base.version
  const sameCompany = (started: string | null) =>
    useCompanyStore.getState().activeCompanyId === started

  const save = useMutation({
    mutationFn: async ({ values: v }: { values: OrderValues; company: string | null }) => {
      setLastValues(v)
      const input = orderToInput(v)
      // Untouched lines stay as stored (quoted / requested prices and provenance kept).
      if (base && orderLinesUnchanged(v, base)) delete input.lines
      if (revising && base) {
        // The API rewrites the order from the full payload; lines are always sent.
        const body = { ...orderToInput(v), version: base.version }
        return ordersApi.revise(base.id, body, keyFor({ revise: base.id, ...body }))
      }
      if (base) return ordersApi.update(base.id, { ...input, version: base.version })
      return ordersApi.create(input, keyFor({ create: 'order', ...input }))
    },
    onSuccess: ({ document: saved }: ActionResult<PurchaseOrder>, { company: started }) => {
      keyFor.reset()
      queryClient.setQueryData(
        purchKeys.detail('order', saved.id, started ?? 'none'),
        (prev?: PurchaseOrder) =>
          prev ? { ...saved, links: prev.links, audit: prev.audit } : saved,
      )
      invalidatePurchasing(queryClient, started ?? 'none')
      if (!sameCompany(started)) return
      setBase(saved)
      form.reset(orderToValues(saved))
    },
    onError: (error, { company: started }) => {
      if (sameCompany(started) && isVersionConflict(error)) setConflict(true)
    },
  })

  const remove = useMutation({
    mutationFn: ({ target }: { target: PurchaseOrder; company: string | null }) =>
      ordersApi.remove(target.id, target.version),
    onSuccess: (_, { company: started }) => {
      invalidatePurchasing(queryClient, started ?? 'none')
      if (!sameCompany(started)) return
      platform.notify.success(t('editor.deleted'))
      void navigate(PURCH_PATHS.order)
    },
    onError: (error, { company: started }) => {
      if (!sameCompany(started)) return
      if (isVersionConflict(error)) setConflict(true)
      else platform.notify.error(errorMessage(error, t('errors.generic')))
    },
  })

  const runSave = async (v: OrderValues): Promise<PurchaseOrder | null> => {
    const started = company
    try {
      const { document: saved, warnings } = await save.mutateAsync({ values: v, company: started })
      if (!sameCompany(started)) return null
      notifyWarnings(warnings)
      if (revising) {
        platform.notify.success(
          saved.status === 'pending_approval' ? t('orders.revisedPending') : t('orders.revised'),
        )
        onRevised?.(saved)
      } else {
        platform.notify.success(t('editor.saved'))
        if (!base) void navigate(`${PURCH_PATHS.order}/${saved.id}`, { replace: true })
      }
      return saved
    } catch {
      // Shown by the error summary or the conflict alert.
      return null
    }
  }

  const submitSave = form.handleSubmit(async (v) => {
    await runSave(v)
  })

  const ensureSaved = async (): Promise<PurchaseOrder | null> => {
    if (!base) return null
    if (!isDirty) return base
    if (!(await form.trigger())) return null
    return runSave(form.getValues())
  }

  const reload = async () => {
    const fresh = await onReload()
    if (fresh) {
      setBase(fresh)
      form.reset(orderToValues(fresh))
    }
    setConflict(false)
    save.reset()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (canEdit && !save.isPending) void submitSave()
    }
  }

  const disabled = !canEdit || save.isPending
  const busy = save.isPending || remove.isPending
  const warnings: PurchaseWarning[] = pristine ? [] : (preview.data?.warnings ?? [])
  const totals = pristine ? base : (preview.data ?? null)
  const lineLabel = (w: PurchaseWarning) => {
    if (w.line_key) {
      const index = values.lines.findIndex((l) => l.key === w.line_key)
      return index >= 0 ? t('warnings.line', { index: index + 1 }) : null
    }
    return w.line_no ? t('warnings.line', { index: w.line_no }) : null
  }
  const number = document?.number ?? t('common.unnumbered')
  const title = revising
    ? t('orders.reviseTitle', { number })
    : document
      ? t('orders.editTitle', { number })
      : t('orders.newTitle')

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6" onKeyDown={onKeyDown}>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('nav.purchasing') },
          { label: t('nav.orders'), to: PURCH_PATHS.order },
          { label: document ? number : t('common.new') },
        ]}
        meta={document ? <PurchStatusBadge kind="order" status={document.status} /> : undefined}
        actions={
          <>
            {revising && (
              <Button type="button" variant="ghost" disabled={busy} onClick={onCancelRevise}>
                <X aria-hidden="true" />
                {t('orders.cancelRevise')}
              </Button>
            )}
            {document && !revising && canDelete && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden="true" />
                {t('editor.delete')}
              </Button>
            )}
            {canEdit && (
              <Button
                type="button"
                variant={actions && document ? 'secondary' : 'primary'}
                disabled={busy}
                onClick={() => void submitSave()}
              >
                {save.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save aria-hidden="true" />
                )}
                {revising ? t('orders.saveRevise') : t('editor.saveDraft')}
              </Button>
            )}
            {document && !revising && actions?.({ ensureSaved, busy })}
          </>
        }
      />
      <Form form={form} onSubmit={() => void submitSave()} className="space-y-4">
        {(conflict || changedElsewhere) && <VersionConflictAlert onReload={() => void reload()} />}
        {!canEdit && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('editor.readOnly')}
          </p>
        )}
        {revising && (
          <p role="note" className="text-sm text-muted-foreground">
            {t('orders.reviseHelp')}
          </p>
        )}
        <FormErrorSummary
          error={conflict ? null : save.error}
          mapField={orderFieldMapper(lastValues ?? form.getValues())}
          fieldLabels={{
            partyId: t('fields.supplier'),
            documentDate: t('fields.documentDate'),
            expectedDate: t('fields.expectedDate'),
            currencyCode: t('fields.currency'),
            fxRate: t('fields.fxRate'),
            paymentTermId: t('fields.paymentTerm'),
            warehouseId: t('fields.warehouse'),
            supplierReference: t('fields.supplierReference'),
            notes: t('fields.notes'),
            internalNotes: t('fields.internalNotes'),
            lines: t('lines.title'),
          }}
        />
        <section
          aria-label={t('editor.header')}
          className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <div className="space-y-1.5 md:col-span-2">
            <FormField<OrderValues, 'partyId'>
              name="partyId"
              label={t('fields.supplier')}
              required
              render={({ field, control }) => (
                <SupplierPicker
                  {...control}
                  ref={field.ref}
                  value={field.value}
                  name={document?.party_name}
                  disabled={disabled || revising}
                  onBlur={field.onBlur}
                  onChange={(id, party) => {
                    field.onChange(id ?? '')
                    const opts = { shouldDirty: true }
                    form.setValue('partyName', party?.name ?? '', opts)
                    if (!party) return
                    if (
                      party.default_currency_code &&
                      party.default_currency_code !== form.getValues('currencyCode')
                    ) {
                      form.setValue('currencyCode', party.default_currency_code, opts)
                      // Another currency: the rate of the document date again.
                      form.setValue('fxRate', '', opts)
                    }
                    form.setValue('paymentTermId', party.payment_term_id ?? '', opts)
                  }}
                />
              )}
            />
            {values.partyId && (
              <SupplierExposureBadge
                partyId={values.partyId}
                documentTotalLocal={totals?.total_local ?? null}
                counted={
                  base !== null && base.status !== 'draft' && base.status !== 'pending_approval'
                }
              />
            )}
          </div>
          <FormField<OrderValues, 'documentDate'>
            name="documentDate"
            label={t('fields.documentDate')}
            required
            render={({ field, control }) => (
              <DateInput
                {...control}
                ref={field.ref}
                value={field.value}
                disabled={disabled}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
          <FormField<OrderValues, 'expectedDate'>
            name="expectedDate"
            label={t('fields.expectedDate')}
            render={({ field, control }) => (
              <DateInput
                {...control}
                ref={field.ref}
                value={field.value}
                disabled={disabled}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
          <FormField<OrderValues, 'currencyCode'>
            name="currencyCode"
            label={t('fields.currency')}
            required
            render={({ field, control }) => (
              <CurrencySelect
                {...control}
                ref={field.ref}
                value={field.value || null}
                clearable={false}
                disabled={disabled || revising}
                onBlur={field.onBlur}
                onChange={(v) => {
                  if ((v ?? '') !== field.value) form.setValue('fxRate', '', { shouldDirty: true })
                  field.onChange(v ?? '')
                }}
              />
            )}
          />
          <FormField<OrderValues, 'fxRate'>
            name="fxRate"
            label={t('fields.fxRate')}
            description={t('fields.fxRateHelp')}
            render={({ field, control }) => (
              <DecimalInput
                {...control}
                ref={field.ref}
                scale={6}
                displayMinFraction={0}
                value={field.value}
                disabled={disabled || revising}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
          <FormField<OrderValues, 'paymentTermId'>
            name="paymentTermId"
            label={t('fields.paymentTerm')}
            render={({ field, control }) => (
              <PaymentTermSelect
                {...control}
                ref={field.ref}
                value={field.value || null}
                disabled={disabled}
                onBlur={field.onBlur}
                onChange={(v) => field.onChange(v ?? '')}
              />
            )}
          />
          <FormField<OrderValues, 'warehouseId'>
            name="warehouseId"
            label={t('fields.warehouse')}
            render={({ field, control }) => (
              <WarehouseSelect
                {...control}
                ref={field.ref}
                value={field.value || null}
                disabled={disabled}
                onBlur={field.onBlur}
                onChange={(v) => field.onChange(v ?? '')}
              />
            )}
          />
          <FormField<OrderValues, 'supplierReference'>
            name="supplierReference"
            label={t('fields.supplierReference')}
            render={({ field, control }) => (
              <Input {...control} {...field} disabled={disabled} maxLength={100} />
            )}
          />
        </section>
        <OrderLinesGrid disabled={disabled} preview={previewByKey} pending={preview.stale} />
        <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
          <section aria-label={t('editor.notes')} className="grid content-start gap-4">
            <FormField<OrderValues, 'notes'>
              name="notes"
              label={t('fields.notes')}
              description={t('fields.notesHelp')}
              render={({ field, control }) => (
                <Input {...control} {...field} disabled={disabled} maxLength={5000} />
              )}
            />
            <FormField<OrderValues, 'internalNotes'>
              name="internalNotes"
              label={t('fields.internalNotes')}
              description={t('fields.internalNotesHelp')}
              render={({ field, control }) => (
                <Input {...control} {...field} disabled={disabled} maxLength={5000} />
              )}
            />
            <WarningsList warnings={warnings} lineLabel={lineLabel} />
          </section>
          <PurchTotals
            totals={totals}
            currency={values.currencyCode}
            localCurrency={companyCurrency}
            pending={preview.stale}
            error={preview.isError}
            onRetry={() => void preview.refetch()}
          />
        </div>
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </Form>
      {document && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('orders.deleteTitle')}
          description={t('editor.deleteBody')}
          confirmLabel={t('editor.delete')}
          onConfirm={async () => {
            await remove.mutateAsync({ target: base ?? document, company })
          }}
        />
      )}
    </div>
  )
}
