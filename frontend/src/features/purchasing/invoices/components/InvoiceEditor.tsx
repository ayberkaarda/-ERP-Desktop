import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BookCheck, Loader2, Save, Trash2 } from 'lucide-react'
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
import { PartyCombobox } from '@/features/parties'
import { CurrencySelect, PaymentTermSelect, WarehouseSelect } from '@/features/reference'
import { useCompanyCurrency } from '@/features/sales/invoices/kit/viewKey'
import { VersionConflictAlert } from '@/features/sales/shared/components/common'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { invoicesApi, type BookResult } from '../api'
import { createKeys } from '../kit/createKeys'
import { DocLinks } from '../kit/components/DocLinks'
import { InvoiceStatusBadge } from '../kit/components/StatusBadges'
import { SupplierExposureBadge } from '../kit/components/SupplierExposureBadge'
import { TotalsPanel } from '../kit/components/TotalsPanel'
import { errorMessage, isDocumentLocked, isVersionConflict } from '../kit/http'
import { purchKeys } from '../kit/keys'
import { INVOICES_BASE } from '../kit/links'
import { PURCH_PERMS, saveDraftPermission } from '../kit/permissions'
import { MAX_LINES } from '../kit/types'
import {
  estimateTotals,
  invoiceFieldMapper,
  toInvoiceInput,
  toPreviewInput,
  unreceivedGoods,
  valuesFromInvoice,
  type InvoiceValues,
} from '../lib/lines'
import { invoiceSchema, type InvoiceMessages } from '../lib/schema'
import { useInvoiceMatch, usePreviewTotals } from '../queries'
import type { Invoice } from '../types'
import { BookDialog } from './BookDialog'
import { InvoiceLinesGrid } from './InvoiceLinesGrid'
import { MatchPanel } from './MatchPanel'

interface InvoiceEditorProps {
  invoice: Invoice | null
  initialValues: InvoiceValues
  onReload: () => Promise<Invoice | undefined>
  onBooked: (result: BookResult) => void
}

/**
 * Draft supplier invoice: supplier and its invoice number, lines (direct or from receipts and
 * orders), server totals with withholding, the live three-way match, save and book.
 */
export function InvoiceEditor({ invoice, initialValues, onReload, onBooked }: InvoiceEditorProps) {
  const { t } = useTranslation('purchasing-docs')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const canSave = usePermission(saveDraftPermission('invoices', invoice !== null))
  const canBook = usePermission(PURCH_PERMS.invoices.book)
  const canDelete = usePermission(PURCH_PERMS.invoices.delete)
  const canOverridePrice = usePermission(PURCH_PERMS.priceOverride)
  const company = useCompanyStore((s) => s.activeCompanyId)
  const companyCurrency = useCompanyCurrency()
  const [base, setBase] = useState<Invoice | null>(invoice)
  const [conflict, setConflict] = useState(false)
  // 409 DOCUMENT_LOCKED: the invoice was booked while it was being edited.
  const [locked, setLocked] = useState(false)
  const [booking, setBooking] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lastValues, setLastValues] = useState<InvoiceValues | null>(null)
  const match = useInvoiceMatch(base?.id)

  const messages: InvoiceMessages = useMemo(
    () => ({
      party: t('validation.supplier'),
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
  const unreceived = unreceivedGoods(values)
  const sameCompany = (started: string | null) =>
    useCompanyStore.getState().activeCompanyId === started
  const changedElsewhere =
    invoice !== null && base !== null && invoice.id === base.id && invoice.version !== base.version

  const save = useMutation({
    mutationFn: ({ values: v, company: c }: { values: InvoiceValues; company: string | null }) => {
      setLastValues(v)
      const input = toInvoiceInput(v)
      return base
        ? invoicesApi.update(base.id, { ...input, version: base.version })
        : invoicesApi.create(input, createKeys.keyFor(c ?? 'none', 'invoice', input))
    },
    onSuccess: (saved, { values: sent, company: started }) => {
      const c = started ?? 'none'
      queryClient.setQueryData(purchKeys.detail('invoices', saved.id, c), saved)
      void queryClient.invalidateQueries({ queryKey: purchKeys.branch('invoices', c) })
      createKeys.release(c, 'invoice', toInvoiceInput(sent))
      if (!sameCompany(started)) return
      setBase(saved)
      form.reset(valuesFromInvoice(saved))
    },
    onError: (error, { company: started }) => {
      if (!sameCompany(started)) return
      if (isVersionConflict(error)) setConflict(true)
      else if (isDocumentLocked(error)) setLocked(true)
    },
  })

  const remove = useMutation({
    mutationFn: ({ target }: { target: Invoice; company: string | null }) =>
      invoicesApi.remove(target.id, target.version),
    onSuccess: (_, { company: started }) => {
      void queryClient.invalidateQueries({
        queryKey: purchKeys.branch('invoices', started ?? 'none'),
      })
      if (!sameCompany(started)) return
      platform.notify.success(t('editor.deleted'))
      void navigate(INVOICES_BASE)
    },
    onError: (error, { company: started }) => {
      if (!sameCompany(started)) return
      if (isVersionConflict(error)) setConflict(true)
      else if (isDocumentLocked(error)) setLocked(true)
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

  /** Saves pending edits, then opens the book dialog on the stored version. */
  const submitBook = form.handleSubmit(async (v) => {
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
      if (sameCompany(started)) setBooking(true)
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
    setLocked(false)
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
  const actionError = conflict || locked ? null : save.error

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6" onKeyDown={onKeyDown}>
      <PageHeader
        title={invoice ? t('invoice.editTitle') : t('invoice.newTitle')}
        description={t('invoice.editorDescription')}
        breadcrumbs={[
          { label: t('nav.purchasing') },
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
            {canBook && (canSave || invoice) && (
              <Button type="button" disabled={busy} onClick={() => void submitBook()}>
                <BookCheck aria-hidden="true" />
                {t('invoice.book')}
              </Button>
            )}
          </>
        }
      />
      <Form form={form} onSubmit={() => void submitSave()} className="space-y-4">
        {locked ? (
          <VersionConflictAlert locked onReload={() => void reload()} />
        ) : (
          (conflict || changedElsewhere) && <VersionConflictAlert onReload={() => void reload()} />
        )}
        {!canSave && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('editor.readOnly')}
          </p>
        )}
        {base?.approval_comment && (
          <p
            role="status"
            className="rounded-md bg-warning-soft p-3 text-sm text-warning-soft-foreground"
          >
            {t('invoice.approvalComment', { comment: base.approval_comment })}
          </p>
        )}
        <FormErrorSummary
          error={actionError}
          mapField={invoiceFieldMapper(lastValues ?? form.getValues())}
          fieldLabels={{
            partyId: t('fields.supplier'),
            supplierInvoiceNo: t('fields.supplierInvoiceNo'),
            documentDate: t('fields.documentDate'),
            dueDate: t('fields.dueDate'),
            currencyCode: t('fields.currency'),
            fxRate: t('fields.fxRate'),
            paymentTermId: t('fields.paymentTerm'),
            warehouseId: t('fields.warehouse'),
            notes: t('fields.notes'),
            internalNotes: t('fields.internalNotes'),
            receiveOnInvoice: t('invoice.receiveOnInvoice'),
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
                label={t('fields.supplier')}
                required
                render={({ field, control }) => (
                  <PartyCombobox
                    {...control}
                    ref={field.ref}
                    value={field.value || null}
                    role="supplier"
                    disabled={
                      disabled ||
                      (base?.lines.some((l) => l.receipt_line_id ?? l.order_line_id) ?? false)
                    }
                    initialParty={
                      base
                        ? {
                            id: base.party_id,
                            code: '',
                            name: values.partyLabel,
                            roles: ['supplier'],
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
              {partyId && <SupplierExposureBadge partyId={partyId} />}
            </div>
            <FormField<InvoiceValues, 'supplierInvoiceNo'>
              name="supplierInvoiceNo"
              label={t('fields.supplierInvoiceNo')}
              description={t('invoice.supplierNoHint')}
              render={({ field, control }) => (
                <Input
                  {...control}
                  {...field}
                  disabled={disabled}
                  maxLength={64}
                  autoComplete="off"
                />
              )}
            />
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
                  value={values.fxAuto ? '' : field.value}
                  placeholder={t('invoice.autoRate')}
                  disabled={disabled}
                  onChange={(v) => {
                    field.onChange(v)
                    form.setValue('fxAuto', v === '', { shouldDirty: true })
                  }}
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
                  <Input {...control} {...field} disabled={disabled} maxLength={5000} />
                )}
              />
            </div>
            <div className="md:col-span-2">
              <FormField<InvoiceValues, 'internalNotes'>
                name="internalNotes"
                label={t('fields.internalNotes')}
                render={({ field, control }) => (
                  <Input {...control} {...field} disabled={disabled} maxLength={5000} />
                )}
              />
            </div>
            {(unreceived > 0 || values.receiveOnInvoice) && (
              <label className="flex items-start gap-2 text-sm md:col-span-4">
                <Checkbox
                  className="mt-0.5"
                  checked={values.receiveOnInvoice}
                  disabled={disabled}
                  onChange={(e) =>
                    form.setValue('receiveOnInvoice', e.target.checked, { shouldDirty: true })
                  }
                />
                <span>
                  {t('invoice.receiveOnInvoice')}
                  <span className="block text-xs text-muted-foreground">
                    {t('invoice.receiveOnInvoiceHint', { count: unreceived })}
                  </span>
                </span>
              </label>
            )}
          </section>
          <TotalsPanel
            totals={fresh ?? estimate}
            currency={currency}
            localCurrency={companyCurrency}
            estimate={!fresh}
            loading={preview.isFetching}
            warnings={fresh?.warnings ?? base?.warnings ?? []}
          />
        </div>
        <InvoiceLinesGrid disabled={disabled} canOverridePrice={canOverridePrice} preview={fresh} />
        {base && (
          <MatchPanel
            match={match.data ?? base.match}
            lines={base.lines}
            loading={match.isFetching}
            live
          />
        )}
        <DocLinks links={base?.links} />
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </Form>
      {base && (
        <BookDialog
          invoice={base}
          open={booking}
          onOpenChange={setBooking}
          onBooked={onBooked}
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
