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
import { PartyCombobox } from '@/features/parties'
import { CurrencySelect, PaymentTermSelect, WarehouseSelect } from '@/features/reference'
import { toIsoDate } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { ordersApi, quotesApi, type ActionResult, type SalesOrder, type SalesQuote } from '../api'
import { useCompanyCurrency, usePreviewTotals } from '../hooks/queries'
import { errorMessage, isCreditLimitExceeded, isVersionConflict } from '../lib/errors'
import { usePayloadKeys } from '../lib/idempotency'
import { notifyWarnings } from '../lib/notify'
import { SALES_PATHS } from '../lib/insights'
import { invalidateSales, salesKeys } from '../lib/keys'
import {
  docSchema,
  emptyValues,
  linesUnchanged,
  previewInput,
  serverFieldMapper,
  toInput,
  toValues,
  type DocMessages,
  type DocValues,
} from '../lib/lines'
import { SALES_PERMS } from '../permissions'
import { MAX_LINES, type PreviewLine, type SalesKind, type SalesWarning } from '../types'
import { SalesStatusBadge, VersionConflictAlert } from './common'
import { CreditOverrideDialog } from './CreditOverrideDialog'
import { ExposureBadge } from './ExposureBadge'
import { SalesLinesGrid } from './SalesLinesGrid'
import { TotalsPanel, WarningsList } from './TotalsPanel'

type SalesDoc = SalesQuote | SalesOrder

export interface EditorActionContext<T extends SalesDoc> {
  /** The stored draft; unsaved edits are saved first (null when validation or saving failed). */
  ensureSaved: () => Promise<T | null>
  busy: boolean
}

interface SalesDocumentEditorProps<T extends SalesDoc> {
  kind: SalesKind
  /** null for a new document. */
  document: T | null
  /** revise = a confirmed order edited through POST /sales-orders/{id}/revise. */
  mode?: 'draft' | 'revise'
  onReload: () => Promise<T | undefined>
  /** After a revise was stored (the page returns to the read-only view). */
  onRevised?: (doc: T) => void
  onCancelRevise?: () => void
  /** Lifecycle buttons of a stored draft (send, confirm). */
  actions?: (ctx: EditorActionContext<T>) => ReactNode
}

/**
 * Quote / order editor: header (customer with exposure, dates, currency, terms, warehouse),
 * lines on DocumentLinesEditor with server prices and totals (debounced preview), save draft
 * (POST with Idempotency-Key, PATCH with version), delete, and revise of confirmed orders.
 */
export function SalesDocumentEditor<T extends SalesDoc>({
  kind,
  document,
  mode = 'draft',
  onReload,
  onRevised,
  onCancelRevise,
  actions,
}: SalesDocumentEditorProps<T>) {
  const { t } = useTranslation('sales-shared')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const company = useCompanyStore((s) => s.activeCompanyId)
  const perms = kind === 'quote' ? SALES_PERMS.quotes : SALES_PERMS.orders
  const canCreate = usePermission(perms.create)
  const canUpdate = usePermission(perms.update)
  const canDelete = usePermission(perms.delete)
  const canEdit = document ? canUpdate : canCreate
  const revising = mode === 'revise'
  const [base, setBase] = useState<T | null>(document)
  const [conflict, setConflict] = useState(false)
  const [creditError, setCreditError] = useState<unknown>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lastValues, setLastValues] = useState<DocValues | null>(null)
  const listPath = SALES_PATHS[kind]

  const messages: DocMessages = useMemo(
    () => ({
      party: t('validation.party'),
      currency: t('validation.currency'),
      minLines: t('validation.minLines'),
      maxLines: t('validation.maxLines', { max: MAX_LINES }),
      item: t('validation.item'),
      unit: t('validation.unit'),
      quantity: t('validation.quantity'),
      price: t('validation.price'),
      discountPercent: t('validation.discountPercent'),
      discountAmount: t('validation.discountAmount'),
      validUntil: t('validation.validUntil'),
      fxRate: t('validation.fxRate'),
    }),
    [t],
  )
  const form = useForm<DocValues>({
    resolver: zodResolver(docSchema(kind, messages)),
    defaultValues: document
      ? toValues(document)
      : emptyValues(kind, { today: toIsoDate(new Date()) }),
  })
  const { isDirty } = useFormState({ control: form.control })
  const values = useWatch({ control: form.control }) as DocValues
  // An unchanged stored document shows what is stored (and what send/confirm act on); the
  // server preview only runs once something was edited.
  const pristine = base !== null && !isDirty
  const preview = usePreviewTotals(pristine ? null : previewInput(values, kind))
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
                line_total: l.line_total,
              },
            ])
          : (preview.data?.lines ?? []).map((l) => [l.key, l]),
      ),
    [pristine, base, preview.data],
  )
  const partyId = values.partyId
  const currency = values.currencyCode
  const companyCurrency = useCompanyCurrency()
  // Rate 1 means the document is in company currency; otherwise the company's currency.
  const localCurrency =
    preview.data?.local_currency_code ??
    (base && currency === base.currency_code ? base.local_currency_code : null) ??
    companyCurrency

  const changedElsewhere =
    document !== null &&
    base !== null &&
    document.id === base.id &&
    document.version !== base.version
  const sameCompany = (started: string | null) =>
    useCompanyStore.getState().activeCompanyId === started

  const save = useMutation({
    mutationFn: async ({
      values: v,
      reason,
    }: {
      values: DocValues
      company: string | null
      reason?: string
    }): Promise<ActionResult<T>> => {
      setLastValues(v)
      const input = toInput(v, kind)
      // Untouched lines stay as stored (copied prices are not resolved again).
      if (base && linesUnchanged(v, base)) delete input.lines
      if (revising && base) {
        const body = {
          ...input,
          version: base.version,
          ...(reason ? { credit_override_reason: reason } : {}),
        }
        return (await ordersApi.revise(
          base.id,
          body,
          keyFor({ revise: base.id, ...body }),
        )) as ActionResult<T>
      }
      if (base) {
        const body = { ...input, version: base.version }
        return (await (kind === 'quote'
          ? quotesApi.update(base.id, body)
          : ordersApi.update(base.id, body))) as ActionResult<T>
      }
      const key = keyFor({ create: kind, ...input })
      return (await (kind === 'quote'
        ? quotesApi.create(input, key)
        : ordersApi.create(input, key))) as ActionResult<T>
    },
    onSuccess: ({ document: saved }, { company: started }) => {
      keyFor.reset()
      queryClient.setQueryData(salesKeys.detail(kind, saved.id, started ?? 'none'), saved)
      invalidateSales(queryClient, started ?? 'none')
      if (!sameCompany(started)) return
      setBase(saved)
      form.reset(toValues(saved))
    },
    onError: (error, { company: started }) => {
      if (!sameCompany(started)) return
      if (isVersionConflict(error)) setConflict(true)
      else if (revising && isCreditLimitExceeded(error)) setCreditError(error)
    },
  })

  const remove = useMutation({
    mutationFn: ({ target }: { target: T; company: string | null }) =>
      kind === 'quote'
        ? quotesApi.remove(target.id, target.version)
        : ordersApi.remove(target.id, target.version),
    onSuccess: (_, { company: started }) => {
      invalidateSales(queryClient, started ?? 'none')
      if (!sameCompany(started)) return
      platform.notify.success(t('editor.deleted'))
      void navigate(listPath)
    },
    onError: (error, { company: started }) => {
      if (!sameCompany(started)) return
      if (isVersionConflict(error)) setConflict(true)
      else platform.notify.error(errorMessage(error, t('errors.generic')))
    },
  })

  const runSave = async (v: DocValues, reason?: string): Promise<T | null> => {
    const started = company
    try {
      const { document: saved, warnings } = await save.mutateAsync({
        values: v,
        company: started,
        reason,
      })
      if (!sameCompany(started)) return null
      notifyWarnings(warnings)
      if (revising) {
        platform.notify.success(t('editor.revised'))
        onRevised?.(saved)
      } else {
        platform.notify.success(t('editor.saved'))
        if (!base) void navigate(`${listPath}/${saved.id}`, { replace: true })
      }
      return saved
    } catch {
      // Shown by the summary, the conflict alert or the credit dialog.
      return null
    }
  }

  const submitSave = form.handleSubmit(async (v) => {
    await runSave(v)
  })

  const ensureSaved = async (): Promise<T | null> => {
    if (!base) return null
    if (!isDirty) return base
    if (!(await form.trigger())) return null
    return runSave(form.getValues())
  }

  const reload = async () => {
    const fresh = await onReload()
    if (fresh) {
      setBase(fresh)
      form.reset(toValues(fresh))
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
  const actionError = conflict || creditError ? null : save.error
  const kindLabel = t(`kind.${kind}`)
  const warnings = pristine ? (base.warnings ?? []) : (preview.data?.warnings ?? [])
  const totals = pristine ? base : (preview.data ?? null)
  const lineLabel = (w: SalesWarning) => {
    if (w.line_key) {
      const index = values.lines.findIndex((l) => l.key === w.line_key)
      return index >= 0 ? t('warnings.line', { index: index + 1 }) : null
    }
    return w.line_no ? t('warnings.line', { index: w.line_no }) : null
  }

  const title = revising
    ? t('editor.reviseTitle', { number: base?.number ?? '' })
    : document
      ? t('editor.editTitle', {
          kind: kindLabel,
          number: document.number ?? t('editor.unnumbered'),
        })
      : t('editor.newTitle', { kind: kindLabel })

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6" onKeyDown={onKeyDown}>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('nav.sales') },
          { label: t(`nav.${kind}s`), to: listPath },
          { label: document ? (document.number ?? t('editor.unnumbered')) : t('editor.new') },
        ]}
        meta={document ? <SalesStatusBadge kind={kind} status={document.status} /> : undefined}
        actions={
          <>
            {revising && (
              <Button type="button" variant="ghost" disabled={busy} onClick={onCancelRevise}>
                <X aria-hidden="true" />
                {t('editor.cancelRevise')}
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
                {revising ? t('editor.saveRevise') : t('editor.saveDraft')}
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
        <FormErrorSummary
          error={actionError}
          mapField={serverFieldMapper(lastValues ?? form.getValues())}
          fieldLabels={{
            partyId: t('fields.party'),
            documentDate: t('fields.documentDate'),
            validUntil: t('fields.validUntil'),
            requestedDeliveryDate: t('fields.requestedDeliveryDate'),
            currencyCode: t('fields.currency'),
            fxRate: t('fields.fxRate'),
            paymentTermId: t('fields.paymentTerm'),
            warehouseId: t('fields.warehouse'),
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
            <FormField<DocValues, 'partyId'>
              name="partyId"
              label={t('fields.party')}
              required
              render={({ field, control }) => (
                <PartyCombobox
                  {...control}
                  ref={field.ref}
                  role="customer"
                  value={field.value || null}
                  initialParty={
                    document
                      ? {
                          id: document.party_id,
                          code: '',
                          name: document.party.name,
                          roles: ['customer'],
                        }
                      : null
                  }
                  disabled={disabled}
                  showRoles={false}
                  onBlur={field.onBlur}
                  onChange={(id, party) => {
                    field.onChange(id ?? '')
                    const opts = { shouldDirty: true }
                    form.setValue('partyName', party?.name ?? '', opts)
                    if (!party) return
                    if (party.default_currency_code)
                      form.setValue('currencyCode', party.default_currency_code, opts)
                    form.setValue('paymentTermId', party.payment_term_id ?? '', opts)
                    form.setValue('priceListId', party.price_list_id ?? '', opts)
                  }}
                />
              )}
            />
            {partyId && (
              <ExposureBadge
                partyId={partyId}
                documentTotal={totals?.total_local ?? null}
                documentCurrency={localCurrency}
                documentId={kind === 'order' && pristine && !revising ? base.id : null}
                counted={revising && base?.party_id === partyId ? base.total_local : null}
              />
            )}
          </div>
          <FormField<DocValues, 'documentDate'>
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
          {kind === 'quote' ? (
            <FormField<DocValues, 'validUntil'>
              name="validUntil"
              label={t('fields.validUntil')}
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
          ) : (
            <FormField<DocValues, 'requestedDeliveryDate'>
              name="requestedDeliveryDate"
              label={t('fields.requestedDeliveryDate')}
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
          )}
          <FormField<DocValues, 'currencyCode'>
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
                onChange={(v) => field.onChange(v ?? '')}
              />
            )}
          />
          <FormField<DocValues, 'fxRate'>
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
          <FormField<DocValues, 'paymentTermId'>
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
          <FormField<DocValues, 'warehouseId'>
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
        </section>
        <SalesLinesGrid disabled={disabled} preview={previewByKey} pending={preview.stale} />
        <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
          <section aria-label={t('editor.notes')} className="grid content-start gap-4">
            <FormField<DocValues, 'notes'>
              name="notes"
              label={t('fields.notes')}
              description={t('fields.notesHelp')}
              render={({ field, control }) => (
                <Input {...control} {...field} disabled={disabled} maxLength={2000} />
              )}
            />
            <FormField<DocValues, 'internalNotes'>
              name="internalNotes"
              label={t('fields.internalNotes')}
              description={t('fields.internalNotesHelp')}
              render={({ field, control }) => (
                <Input {...control} {...field} disabled={disabled} maxLength={2000} />
              )}
            />
            <WarningsList warnings={warnings} lineLabel={lineLabel} />
          </section>
          <TotalsPanel
            totals={totals}
            currency={currency}
            localCurrency={localCurrency}
            pending={preview.stale}
            error={preview.isError}
            onRetry={() => void preview.refetch()}
          />
        </div>
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </Form>
      {revising && base && (
        <CreditOverrideDialog
          error={creditError}
          onClose={() => setCreditError(null)}
          partyId={base.party_id}
          documentId={base.id}
          documentTotal={totals?.total ?? base.total}
          documentCurrency={currency}
          onOverride={async (reason) => {
            const saved = await runSave(lastValues ?? form.getValues(), reason)
            if (!saved) throw save.error ?? new Error('failed')
            setCreditError(null)
          }}
        />
      )}
      {document && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('editor.deleteTitle', { kind: kindLabel })}
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
