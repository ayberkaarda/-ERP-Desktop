import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save, Trash2 } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useForm, useFormState } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DateInput, Form, FormErrorSummary, FormField } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { errorMessage, isVersionConflict } from '@/features/sales/shared/lib/errors'
import { usePayloadKeys } from '@/features/sales/shared/lib/idempotency'
import { CurrencySelect, WarehouseSelect } from '@/features/reference'
import { toIsoDate } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { rfqsApi } from '../../shared/api'
import { PurchStatusBadge, VersionConflictAlert } from '../../shared/components/common'
import { SupplierList } from '../../shared/components/SupplierList'
import { useCompanyCurrency } from '../../shared/hooks/queries'
import { PURCH_PATHS } from '../../shared/lib/chain'
import { invalidatePurchasing, purchKeys } from '../../shared/lib/keys'
import {
  emptyRfqValues,
  rfqFieldMapper,
  rfqLinesUnchanged,
  rfqSchema,
  rfqToInput,
  rfqToValues,
  type RfqMessages,
  type RfqValues,
} from '../../shared/lib/rfqForm'
import { PURCH_PERMS } from '../../shared/permissions'
import { MAX_LINES, type PurchaseRfq } from '../../shared/types'
import { RfqLinesGrid } from './RfqLinesGrid'

export interface RfqEditorContext {
  ensureSaved: () => Promise<PurchaseRfq | null>
  busy: boolean
}

interface RfqEditorProps {
  document: PurchaseRfq | null
  onReload: () => Promise<PurchaseRfq | undefined>
  actions?: (ctx: RfqEditorContext) => ReactNode
}

/** Draft RFQ: dates, currency, warehouse, invited suppliers and the lines to quote. */
export function RfqEditor({ document, onReload, actions }: RfqEditorProps) {
  const { t } = useTranslation('purchasing-orders')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const company = useCompanyStore((s) => s.activeCompanyId)
  const canEdit = usePermission(document ? PURCH_PERMS.rfqs.update : PURCH_PERMS.rfqs.create)
  const canDelete = usePermission(PURCH_PERMS.rfqs.delete)
  const companyCurrency = useCompanyCurrency()
  const [base, setBase] = useState<PurchaseRfq | null>(document)
  const [conflict, setConflict] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lastValues, setLastValues] = useState<RfqValues | null>(null)

  const messages: RfqMessages = useMemo(
    () => ({
      currency: t('validation.currency'),
      minLines: t('validation.minLines'),
      maxLines: t('validation.maxLines', { max: MAX_LINES }),
      item: t('validation.item'),
      unit: t('validation.unit'),
      quantity: t('validation.quantity'),
      responseDue: t('validation.responseDue'),
      suppliers: t('validation.suppliersMax'),
    }),
    [t],
  )
  const form = useForm<RfqValues>({
    resolver: zodResolver(rfqSchema(messages)),
    defaultValues: document
      ? rfqToValues(document)
      : emptyRfqValues(toIsoDate(new Date()), companyCurrency),
  })
  const { isDirty } = useFormState({ control: form.control })
  const changedElsewhere =
    document !== null &&
    base !== null &&
    document.id === base.id &&
    document.version !== base.version
  const sameCompany = (started: string | null) =>
    useCompanyStore.getState().activeCompanyId === started

  const save = useMutation({
    mutationFn: ({ values: v }: { values: RfqValues; company: string | null }) => {
      setLastValues(v)
      const input = rfqToInput(v)
      if (base && rfqLinesUnchanged(v, base)) delete input.lines
      if (base) return rfqsApi.update(base.id, { ...input, version: base.version })
      return rfqsApi.create(input, keyFor({ create: 'rfq', ...input }))
    },
    onSuccess: ({ document: saved }, { company: started }) => {
      keyFor.reset()
      queryClient.setQueryData(
        purchKeys.detail('rfq', saved.id, started ?? 'none'),
        (prev?: PurchaseRfq) => (prev ? { ...saved, links: prev.links, audit: prev.audit } : saved),
      )
      invalidatePurchasing(queryClient, started ?? 'none')
      if (!sameCompany(started)) return
      setBase(saved)
      form.reset(rfqToValues(saved))
    },
    onError: (error, { company: started }) => {
      if (sameCompany(started) && isVersionConflict(error)) setConflict(true)
    },
  })

  const remove = useMutation({
    mutationFn: ({ target }: { target: PurchaseRfq; company: string | null }) =>
      rfqsApi.remove(target.id, target.version),
    onSuccess: (_, { company: started }) => {
      invalidatePurchasing(queryClient, started ?? 'none')
      if (!sameCompany(started)) return
      platform.notify.success(t('editor.deleted'))
      void navigate(PURCH_PATHS.rfq)
    },
    onError: (error, { company: started }) => {
      if (!sameCompany(started)) return
      if (isVersionConflict(error)) setConflict(true)
      else platform.notify.error(errorMessage(error, t('errors.generic')))
    },
  })

  const runSave = async (v: RfqValues): Promise<PurchaseRfq | null> => {
    const started = company
    try {
      const { document: saved } = await save.mutateAsync({ values: v, company: started })
      if (!sameCompany(started)) return null
      platform.notify.success(t('editor.saved'))
      if (!base) void navigate(`${PURCH_PATHS.rfq}/${saved.id}`, { replace: true })
      return saved
    } catch {
      return null
    }
  }

  const submitSave = form.handleSubmit(async (v) => {
    await runSave(v)
  })

  const ensureSaved = async (): Promise<PurchaseRfq | null> => {
    if (!base) return null
    if (!isDirty) return base
    if (!(await form.trigger())) return null
    return runSave(form.getValues())
  }

  const reload = async () => {
    const fresh = await onReload()
    if (fresh) {
      setBase(fresh)
      form.reset(rfqToValues(fresh))
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
  const number = document?.number ?? t('common.unnumbered')

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6" onKeyDown={onKeyDown}>
      <PageHeader
        title={document ? t('rfqs.editTitle', { number }) : t('rfqs.newTitle')}
        breadcrumbs={[
          { label: t('nav.purchasing') },
          { label: t('nav.rfqs'), to: PURCH_PATHS.rfq },
          { label: document ? number : t('common.new') },
        ]}
        meta={document ? <PurchStatusBadge kind="rfq" status={document.status} /> : undefined}
        actions={
          <>
            {document && canDelete && (
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
                {t('editor.saveDraft')}
              </Button>
            )}
            {document && actions?.({ ensureSaved, busy })}
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
          error={conflict ? null : save.error}
          mapField={rfqFieldMapper(lastValues ?? form.getValues())}
          fieldLabels={{
            documentDate: t('fields.documentDate'),
            responseDue: t('fields.responseDue'),
            currencyCode: t('fields.currency'),
            warehouseId: t('fields.warehouse'),
            notes: t('fields.notes'),
            internalNotes: t('fields.internalNotes'),
            suppliers: t('rfqs.suppliers'),
            lines: t('lines.title'),
          }}
        />
        <section
          aria-label={t('editor.header')}
          className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <FormField<RfqValues, 'documentDate'>
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
          <FormField<RfqValues, 'responseDue'>
            name="responseDue"
            label={t('fields.responseDue')}
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
          <FormField<RfqValues, 'currencyCode'>
            name="currencyCode"
            label={t('fields.currency')}
            description={t('rfqs.currencyHelp')}
            required
            render={({ field, control }) => (
              <CurrencySelect
                {...control}
                ref={field.ref}
                value={field.value || null}
                clearable={false}
                disabled={disabled}
                onBlur={field.onBlur}
                onChange={(v) => field.onChange(v ?? '')}
              />
            )}
          />
          <FormField<RfqValues, 'warehouseId'>
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
          <div className="md:col-span-2 xl:col-span-4">
            <FormField<RfqValues, 'suppliers'>
              name="suppliers"
              label={t('rfqs.suppliers')}
              description={t('rfqs.suppliersHelp')}
              render={({ field, control }) => (
                <SupplierList
                  {...control}
                  value={field.value}
                  disabled={disabled}
                  onChange={(next) => field.onChange(next)}
                />
              )}
            />
          </div>
        </section>
        <RfqLinesGrid disabled={disabled} />
        <section aria-label={t('editor.notes')} className="grid gap-4 md:grid-cols-2">
          <FormField<RfqValues, 'notes'>
            name="notes"
            label={t('fields.notes')}
            description={t('rfqs.notesHelp')}
            render={({ field, control }) => (
              <Input {...control} {...field} disabled={disabled} maxLength={5000} />
            )}
          />
          <FormField<RfqValues, 'internalNotes'>
            name="internalNotes"
            label={t('fields.internalNotes')}
            description={t('fields.internalNotesHelp')}
            render={({ field, control }) => (
              <Input {...control} {...field} disabled={disabled} maxLength={5000} />
            )}
          />
        </section>
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </Form>
      {document && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('rfqs.deleteTitle')}
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
