import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Decimal from 'decimal.js'
import { Loader2, Save, Trash2 } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useForm, useFormState, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DateInput, Form, FormErrorSummary, FormField } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { errorMessage, isVersionConflict } from '@/features/sales/shared/lib/errors'
import { usePayloadKeys } from '@/features/sales/shared/lib/idempotency'
import { WarehouseSelect } from '@/features/reference'
import { toIsoDate, useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { requestsApi } from '../../shared/api'
import { PurchStatusBadge, VersionConflictAlert } from '../../shared/components/common'
import { useCompanyCurrency } from '../../shared/hooks/queries'
import { PURCH_PATHS } from '../../shared/lib/chain'
import { dec, isDecimal } from '../../shared/lib/forms'
import { invalidatePurchasing, purchKeys } from '../../shared/lib/keys'
import {
  emptyRequestValues,
  requestFieldMapper,
  requestLinesUnchanged,
  requestSchema,
  requestToInput,
  requestToValues,
  type RequestMessages,
  type RequestValues,
} from '../../shared/lib/requestForm'
import { PURCH_PERMS } from '../../shared/permissions'
import { MAX_LINES, type PurchaseRequest } from '../../shared/types'
import { RequestLinesGrid } from './RequestLinesGrid'

export interface RequestEditorContext {
  ensureSaved: () => Promise<PurchaseRequest | null>
  busy: boolean
}

interface RequestEditorProps {
  document: PurchaseRequest | null
  onReload: () => Promise<PurchaseRequest | undefined>
  actions?: (ctx: RequestEditorContext) => ReactNode
}

/**
 * Purchase request editor (drafts, and rejected requests which an edit reopens as drafts):
 * dates, warehouse, lines with estimated prices, suggested suppliers and needed-by dates.
 */
export function RequestEditor({ document, onReload, actions }: RequestEditorProps) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const company = useCompanyStore((s) => s.activeCompanyId)
  const canEdit = usePermission(
    document ? PURCH_PERMS.requests.update : PURCH_PERMS.requests.create,
  )
  const canDelete = usePermission(PURCH_PERMS.requests.delete)
  const companyCurrency = useCompanyCurrency()
  const currency = document?.currency_code ?? companyCurrency
  const [base, setBase] = useState<PurchaseRequest | null>(document)
  const [conflict, setConflict] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lastValues, setLastValues] = useState<RequestValues | null>(null)

  const messages: RequestMessages = useMemo(
    () => ({
      minLines: t('validation.minLines'),
      maxLines: t('validation.maxLines', { max: MAX_LINES }),
      item: t('validation.item'),
      unit: t('validation.unit'),
      quantity: t('validation.quantity'),
      price: t('validation.price'),
      neededBy: t('validation.neededBy'),
    }),
    [t],
  )
  const form = useForm<RequestValues>({
    resolver: zodResolver(requestSchema(messages)),
    defaultValues: document ? requestToValues(document) : emptyRequestValues(toIsoDate(new Date())),
  })
  const { isDirty } = useFormState({ control: form.control })
  const lines = useWatch({ control: form.control, name: 'lines' })
  const estimated = lines.reduce(
    (acc, l) =>
      isDecimal(l.quantity) && isDecimal(l.estimatedPrice)
        ? acc.plus(dec(l.quantity).mul(dec(l.estimatedPrice)))
        : acc,
    new Decimal(0),
  )
  const changedElsewhere =
    document !== null &&
    base !== null &&
    document.id === base.id &&
    document.version !== base.version
  const sameCompany = (started: string | null) =>
    useCompanyStore.getState().activeCompanyId === started

  const save = useMutation({
    mutationFn: ({ values: v }: { values: RequestValues; company: string | null }) => {
      setLastValues(v)
      const input = requestToInput(v)
      if (base && requestLinesUnchanged(v, base)) delete input.lines
      if (base) return requestsApi.update(base.id, { ...input, version: base.version })
      return requestsApi.create(input, keyFor({ create: 'request', ...input }))
    },
    onSuccess: ({ document: saved }, { company: started }) => {
      keyFor.reset()
      queryClient.setQueryData(
        purchKeys.detail('request', saved.id, started ?? 'none'),
        (prev?: PurchaseRequest) =>
          prev ? { ...saved, links: prev.links, audit: prev.audit } : saved,
      )
      invalidatePurchasing(queryClient, started ?? 'none')
      if (!sameCompany(started)) return
      setBase(saved)
      form.reset(requestToValues(saved))
    },
    onError: (error, { company: started }) => {
      if (sameCompany(started) && isVersionConflict(error)) setConflict(true)
    },
  })

  const remove = useMutation({
    mutationFn: ({ target }: { target: PurchaseRequest; company: string | null }) =>
      requestsApi.remove(target.id, target.version),
    onSuccess: (_, { company: started }) => {
      invalidatePurchasing(queryClient, started ?? 'none')
      if (!sameCompany(started)) return
      platform.notify.success(t('editor.deleted'))
      void navigate(PURCH_PATHS.request)
    },
    onError: (error, { company: started }) => {
      if (!sameCompany(started)) return
      if (isVersionConflict(error)) setConflict(true)
      else platform.notify.error(errorMessage(error, t('errors.generic')))
    },
  })

  const runSave = async (v: RequestValues): Promise<PurchaseRequest | null> => {
    const started = company
    try {
      const { document: saved } = await save.mutateAsync({ values: v, company: started })
      if (!sameCompany(started)) return null
      platform.notify.success(t('editor.saved'))
      if (!base) void navigate(`${PURCH_PATHS.request}/${saved.id}`, { replace: true })
      return saved
    } catch {
      return null
    }
  }

  const submitSave = form.handleSubmit(async (v) => {
    await runSave(v)
  })

  const ensureSaved = async (): Promise<PurchaseRequest | null> => {
    if (!base) return null
    if (!isDirty) return base
    if (!(await form.trigger())) return null
    return runSave(form.getValues())
  }

  const reload = async () => {
    const fresh = await onReload()
    if (fresh) {
      setBase(fresh)
      form.reset(requestToValues(fresh))
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
        title={document ? t('requests.editTitle', { number }) : t('requests.newTitle')}
        breadcrumbs={[
          { label: t('nav.purchasing') },
          { label: t('nav.requests'), to: PURCH_PATHS.request },
          { label: document ? number : t('common.new') },
        ]}
        meta={document ? <PurchStatusBadge kind="request" status={document.status} /> : undefined}
        actions={
          <>
            {document?.status === 'draft' && canDelete && (
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
          mapField={requestFieldMapper(lastValues ?? form.getValues())}
          fieldLabels={{
            documentDate: t('fields.documentDate'),
            neededBy: t('fields.neededBy'),
            warehouseId: t('fields.warehouse'),
            notes: t('fields.notes'),
            internalNotes: t('fields.internalNotes'),
            lines: t('lines.title'),
          }}
        />
        <section
          aria-label={t('editor.header')}
          className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-3"
        >
          <FormField<RequestValues, 'documentDate'>
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
          <FormField<RequestValues, 'neededBy'>
            name="neededBy"
            label={t('fields.neededBy')}
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
          <FormField<RequestValues, 'warehouseId'>
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
        <RequestLinesGrid disabled={disabled} currency={currency} />
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <section aria-label={t('editor.notes')} className="grid content-start gap-4">
            <FormField<RequestValues, 'notes'>
              name="notes"
              label={t('fields.notes')}
              render={({ field, control }) => (
                <Input {...control} {...field} disabled={disabled} maxLength={5000} />
              )}
            />
            <FormField<RequestValues, 'internalNotes'>
              name="internalNotes"
              label={t('fields.internalNotes')}
              description={t('fields.internalNotesHelp')}
              render={({ field, control }) => (
                <Input {...control} {...field} disabled={disabled} maxLength={5000} />
              )}
            />
          </section>
          <p
            className="self-start rounded-lg border border-border bg-surface p-4 text-sm"
            data-testid="estimated-total"
          >
            <span className="block text-xs text-muted-foreground">
              {t('fields.estimatedTotal')}
            </span>
            <span className="text-lg font-semibold tabular-nums">
              {formatMoney(estimated.toFixed(2), currency, locale)}
            </span>
          </p>
        </div>
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </Form>
      {document && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('requests.deleteTitle')}
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
