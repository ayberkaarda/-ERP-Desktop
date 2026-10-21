import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileCheck2, Loader2, Save, Trash2 } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { PartyCombobox } from '@/features/parties'
import { CurrencySelect, PaymentTermSelect, WarehouseSelect } from '@/features/reference'
import { invoicesApi, type Invoice } from '../api'
import { DocLinks } from '../kit/components/DocLinks'
import { InvoiceStatusBadge } from '../kit/components/StatusBadges'
import { VersionConflictAlert } from '../kit/components/VersionConflictAlert'
import { errorMessage, isVersionConflict } from '../kit/http'
import { usePayloadKeys } from '../kit/idempotency'
import { salesDocsKeys } from '../kit/keys'
import { INVOICES_BASE } from '../kit/links'
import { SALES_PERMS, saveDraftPermission } from '../kit/permissions'
import { MAX_LINES } from '../kit/types'
import {
  estimateTotals,
  invoiceFieldMapper,
  toInvoiceInput,
  toPreviewInput,
  undeliveredGoods,
  valuesFromInvoice,
  type InvoiceValues,
} from '../lib/lines'
import { invoiceSchema, type InvoiceMessages } from '../lib/schema'
import { usePreviewTotals } from '../queries'
import { ExposureBadge } from './ExposureBadge'
import { InvoiceLinesGrid } from './InvoiceLinesGrid'
import { IssueDialog } from './IssueDialog'
import { TotalsPanel } from './TotalsPanel'

interface InvoiceEditorProps {
  invoice: Invoice | null
  initialValues: InvoiceValues
  onReload: () => Promise<Invoice | undefined>
  onIssued: (inv: Invoice) => void
}

/** Draft invoice: header, priced lines with server preview, save, issue (with credit check). */
export function InvoiceEditor({ invoice, initialValues, onReload, onIssued }: InvoiceEditorProps) {
  const { t } = useTranslation('sales-docs')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const canSave = usePermission(saveDraftPermission('invoices', invoice !== null))
  const canIssue = usePermission(SALES_PERMS.invoices.issue)
  const canDelete = usePermission(SALES_PERMS.invoices.delete)
  const canOverridePrice = usePermission(SALES_PERMS.priceOverride)
  const company = useCompanyStore((s) => s.activeCompanyId)
  const [base, setBase] = useState<Invoice | null>(invoice)
  const [conflict, setConflict] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lastValues, setLastValues] = useState<InvoiceValues | null>(null)

  const messages: InvoiceMessages = useMemo(
    () => ({
      party: t('validation.party'),
      currency: t('validation.currency'),
      fxRate: t('validation.fxRate'),
      dueBeforeDate: t('validation.dueBeforeDate'),
      minLines: t('validation.minLines'),
      maxLines: t('validation.maxLines', { max: MAX_LINES }),
      tooLong: t('validation.tooLong'),
      item: t('validation.item'),
      unit: t('validation.unit'),
      quantity: t('validation.quantityPositive'),
      price: t('validation.price'),
      discount: t('validation.discount'),
      taxCode: t('validation.taxCode'),
    }),
    [t],
  )
  const form = useForm<InvoiceValues>({
    resolver: zodResolver(invoiceSchema(messages)),
    defaultValues: initialValues,
  })
  const { isDirty } = useFormState({ control: form.control })
  const values = useWatch({ control: form.control }) as InvoiceValues
  const partyId = values.partyId
  const currency = values.currencyCode
  const preview = usePreviewTotals(toPreviewInput(values))
  const estimate = estimateTotals(values)
  const fresh = preview.fresh ? (preview.data ?? null) : null
  const undelivered = undeliveredGoods(values)
  const sameCompany = (started: string | null) =>
    useCompanyStore.getState().activeCompanyId === started
  const changedElsewhere =
    invoice !== null && base !== null && invoice.id === base.id && invoice.version !== base.version

  const save = useMutation({
    mutationFn: ({ values: v }: { values: InvoiceValues; company: string | null }) => {
      setLastValues(v)
      const input = toInvoiceInput(v)
      return base
        ? invoicesApi.update(base.id, { ...input, version: base.version })
        : invoicesApi.create(input, keyFor(input))
    },
    onSuccess: (saved, { company: started }) => {
      const c = started ?? 'none'
      queryClient.setQueryData(salesDocsKeys.detail('invoices', saved.id, c), saved)
      void queryClient.invalidateQueries({ queryKey: salesDocsKeys.branch('invoices', c) })
      keyFor.reset()
      if (!sameCompany(started)) return
      setBase(saved)
      form.reset(valuesFromInvoice(saved))
    },
    onError: (error, { company: started }) => {
      if (sameCompany(started) && isVersionConflict(error)) setConflict(true)
    },
  })

  const remove = useMutation({
    mutationFn: ({ target }: { target: Invoice; company: string | null }) =>
      invoicesApi.remove(target.id, target.version),
    onSuccess: (_, { company: started }) => {
      void queryClient.invalidateQueries({
        queryKey: salesDocsKeys.branch('invoices', started ?? 'none'),
      })
      if (!sameCompany(started)) return
      platform.notify.success(t('editor.deleted'))
      void navigate(INVOICES_BASE)
    },
    onError: (error, { company: started }) => {
      if (!sameCompany(started)) return
      if (isVersionConflict(error)) setConflict(true)
      else platform.notify.error(errorMessage(error, t('errors.generic')))
    },
  })

  const submitSave = form.handleSubmit(async (v) => {
    const started = company
    try {
      const saved = await save.mutateAsync({ values: v, company: started })
      if (!sameCompany(started)) return
      platform.notify.success(t('editor.saved'))
      if (!base) void navigate(`${INVOICES_BASE}/${saved.id}`, { replace: true })
    } catch {
      // Shown by the summary / conflict alert.
    }
  })

  /** Saves pending edits, then asks for the issue confirmation on the stored version. */
  const submitIssue = form.handleSubmit(async (v) => {
    const started = company
    try {
      if (!base || isDirty) {
        if (!canSave) return
        const saved = await save.mutateAsync({ values: v, company: started })
        if (!base && sameCompany(started)) {
          void navigate(`${INVOICES_BASE}/${saved.id}`, { replace: true })
          return
        }
      }
      if (sameCompany(started)) setIssuing(true)
    } catch {
      // Shown by the summary / conflict alert.
    }
  })

  const reload = async () => {
    const latest = await onReload()
    if (latest) {
      setBase(latest)
      form.reset(valuesFromInvoice(latest))
    }
    setConflict(false)
    save.reset()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (canSave && !save.isPending) void submitSave()
    }
  }

  const busy = save.isPending
  const disabled = !canSave || busy
  const actionError = conflict ? null : save.error
  const typeLabel =
    values.invoiceType === 'return' ? t('invoiceType.return') : t('invoiceType.sale')

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6" onKeyDown={onKeyDown}>
      <PageHeader
        title={invoice ? t('invoice.editTitle', { type: typeLabel }) : t('invoice.newTitle')}
        description={t('invoice.editorDescription')}
        breadcrumbs={[
          { label: t('nav.sales') },
          { label: t('invoice.listTitle'), to: INVOICES_BASE },
          { label: invoice ? t('invoiceStatus.draft') : t('invoice.new') },
        ]}
        meta={invoice ? <InvoiceStatusBadge status={invoice.status} /> : undefined}
        actions={
          <>
            {invoice && canDelete && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy || remove.isPending}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden="true" />
                {t('editor.delete')}
              </Button>
            )}
            {canSave && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void submitSave()}
              >
                {busy ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save aria-hidden="true" />
                )}
                {t('editor.saveDraft')}
              </Button>
            )}
            {canIssue && (canSave || invoice) && (
              <Button type="button" disabled={busy} onClick={() => void submitIssue()}>
                <FileCheck2 aria-hidden="true" />
                {t('invoice.issue')}
              </Button>
            )}
          </>
        }
      />
      <Form form={form} onSubmit={() => void submitSave()} className="space-y-4">
        {(conflict || changedElsewhere) && <VersionConflictAlert onReload={() => void reload()} />}
        {!canSave && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('editor.readOnly')}
          </p>
        )}
        <FormErrorSummary
          error={actionError}
          mapField={invoiceFieldMapper(lastValues ?? form.getValues())}
          fieldLabels={{
            partyId: t('fields.customer'),
            documentDate: t('fields.documentDate'),
            dueDate: t('fields.dueDate'),
            currencyCode: t('fields.currency'),
            fxRate: t('fields.fxRate'),
            paymentTermId: t('fields.paymentTerm'),
            warehouseId: t('fields.warehouse'),
            notes: t('fields.notes'),
            internalNotes: t('fields.internalNotes'),
            deliverOnInvoice: t('invoice.deliverOnInvoice'),
            lines: t('invoice.lines'),
          }}
        />
        <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
          <section
            aria-label={t('editor.header')}
            className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-4"
          >
            <div className="md:col-span-2">
              <FormField<InvoiceValues, 'partyId'>
                name="partyId"
                label={t('fields.customer')}
                required
                render={({ field, control }) => (
                  <PartyCombobox
                    {...control}
                    ref={field.ref}
                    value={field.value || null}
                    role="customer"
                    disabled={disabled}
                    initialParty={
                      base
                        ? {
                            id: base.party_id,
                            code: '',
                            name: values.partyLabel,
                            roles: ['customer'],
                          }
                        : null
                    }
                    onBlur={field.onBlur}
                    onChange={(id, party) => {
                      field.onChange(id ?? '')
                      form.setValue('partyLabel', party?.name ?? '')
                      if (party?.payment_term_id && !form.getValues('paymentTermId'))
                        form.setValue('paymentTermId', party.payment_term_id, { shouldDirty: true })
                    }}
                  />
                )}
              />
              {partyId && <ExposureBadge partyId={partyId} />}
            </div>
            <FormField<InvoiceValues, 'documentDate'>
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
            <FormField<InvoiceValues, 'dueDate'>
              name="dueDate"
              label={t('fields.dueDate')}
              render={({ field, control }) => (
                <DateInput
                  {...control}
                  ref={field.ref}
                  value={field.value}
                  disabled={disabled}
                  min={values.documentDate || undefined}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            <FormField<InvoiceValues, 'currencyCode'>
              name="currencyCode"
              label={t('fields.currency')}
              required
              render={({ field, control }) => (
                <CurrencySelect
                  {...control}
                  ref={field.ref}
                  value={field.value || null}
                  disabled={disabled}
                  clearable={false}
                  onBlur={field.onBlur}
                  onChange={(v) => field.onChange(v ?? '')}
                />
              )}
            />
            <FormField<InvoiceValues, 'fxRate'>
              name="fxRate"
              label={t('fields.fxRate')}
              render={({ field, control }) => (
                <DecimalInput
                  {...control}
                  ref={field.ref}
                  scale={6}
                  displayMinFraction={0}
                  value={field.value}
                  placeholder={t('invoice.autoRate')}
                  disabled={disabled}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            <FormField<InvoiceValues, 'paymentTermId'>
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
            <FormField<InvoiceValues, 'warehouseId'>
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
            <div className="md:col-span-2">
              <FormField<InvoiceValues, 'notes'>
                name="notes"
                label={t('fields.notes')}
                render={({ field, control }) => (
                  <Input {...control} {...field} disabled={disabled} maxLength={2000} />
                )}
              />
            </div>
            <div className="md:col-span-2">
              <FormField<InvoiceValues, 'internalNotes'>
                name="internalNotes"
                label={t('fields.internalNotes')}
                render={({ field, control }) => (
                  <Input {...control} {...field} disabled={disabled} maxLength={2000} />
                )}
              />
            </div>
            {(undelivered > 0 || values.deliverOnInvoice) && (
              <label className="flex items-start gap-2 text-sm md:col-span-4">
                <Checkbox
                  className="mt-0.5"
                  checked={values.deliverOnInvoice}
                  disabled={disabled}
                  onChange={(e) =>
                    form.setValue('deliverOnInvoice', e.target.checked, { shouldDirty: true })
                  }
                />
                <span>
                  {t('invoice.deliverOnInvoice')}
                  <span className="block text-xs text-muted-foreground">
                    {t('invoice.deliverOnInvoiceHint', { count: undelivered })}
                  </span>
                </span>
              </label>
            )}
          </section>
          <TotalsPanel
            totals={fresh ?? estimate}
            currency={currency}
            estimate={!fresh}
            loading={preview.isFetching}
            warnings={fresh?.warnings ?? base?.warnings ?? []}
          />
        </div>
        <InvoiceLinesGrid disabled={disabled} canOverridePrice={canOverridePrice} preview={fresh} />
        <DocLinks links={base?.links} />
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </Form>
      {base && (
        <IssueDialog
          invoice={base}
          open={issuing}
          onOpenChange={setIssuing}
          onIssued={onIssued}
          onReload={() => void reload()}
        />
      )}
      {base && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('editor.deleteTitle')}
          description={t('editor.deleteBody')}
          confirmLabel={t('editor.delete')}
          onConfirm={async () => {
            await remove.mutateAsync({ target: base, company })
          }}
        />
      )}
    </div>
  )
}
