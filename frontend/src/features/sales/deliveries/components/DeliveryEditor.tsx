import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, Loader2, Save, Trash2 } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { useForm, useFormState, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DateInput, Form, FormErrorSummary, FormField } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { PartyCombobox } from '@/features/parties'
import { WarehouseSelect } from '@/features/reference'
import { VersionConflictAlert } from '../../invoices/kit/components/VersionConflictAlert'
import { DeliveryStatusBadge } from '../../invoices/kit/components/StatusBadges'
import { errorMessage, isVersionConflict } from '../../invoices/kit/http'
import { usePayloadKeys } from '../../invoices/kit/idempotency'
import { invalidateSalesEffects, salesDocsKeys } from '../../invoices/kit/keys'
import { DELIVERIES_BASE, linkTo } from '../../invoices/kit/links'
import { SALES_PERMS, saveDraftPermission } from '../../invoices/kit/permissions'
import { MAX_LINES } from '../../invoices/kit/types'
import { deliveriesApi, type Delivery } from '../api'
import {
  serverFieldMapper,
  sentLines,
  toDeliveryInput,
  toFromOrderInput,
  valuesFromDelivery,
  type DeliveryValues,
} from '../lib/lines'
import { deliverySchema, type DeliveryMessages } from '../lib/schema'
import { DeliveryLinesGrid } from './DeliveryLinesGrid'

interface DeliveryEditorProps {
  /** Stored draft, or null for a new delivery. */
  delivery: Delivery | null
  /** Values of a new delivery (from an order or empty for a direct one). */
  initialValues: DeliveryValues
  onReload: () => Promise<Delivery | undefined>
  onPosted: (d: Delivery) => void
}

/** Draft dispatch note: save (POST / PATCH with version), post with confirmation, delete. */
export function DeliveryEditor({
  delivery,
  initialValues,
  onReload,
  onPosted,
}: DeliveryEditorProps) {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const canSave = usePermission(saveDraftPermission('deliveries', delivery !== null))
  const canPost = usePermission(SALES_PERMS.deliveries.post)
  const canDelete = usePermission(SALES_PERMS.deliveries.delete)
  const company = useCompanyStore((s) => s.activeCompanyId)
  const [base, setBase] = useState<Delivery | null>(delivery)
  const [conflict, setConflict] = useState(false)
  const [confirmPost, setConfirmPost] = useState(
    () =>
      (location.state as { confirmPost?: boolean } | null)?.confirmPost === true &&
      delivery !== null,
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [checking, setChecking] = useState(false)
  const [lastValues, setLastValues] = useState<DeliveryValues | null>(null)

  const messages: DeliveryMessages = useMemo(
    () => ({
      party: t('validation.party'),
      warehouse: t('validation.warehouse'),
      minLines: t('validation.minLines'),
      maxLines: t('validation.maxLines', { max: MAX_LINES }),
      tooLong: t('validation.tooLong'),
      quantity: t('validation.quantity'),
      lot: t('validation.lot'),
      serialCount: (count, quantity) => t('validation.serialCount', { count, quantity }),
      serialInteger: t('validation.serialInteger'),
      serialDuplicate: (serial) => t('validation.serialDuplicate', { serial }),
      overRemaining: t('validation.overRemaining'),
    }),
    [t],
  )
  const form = useForm<DeliveryValues>({
    resolver: zodResolver(deliverySchema(messages)),
    defaultValues: initialValues,
  })
  const { isDirty } = useFormState({ control: form.control })
  const orderId = useWatch({ control: form.control, name: 'orderId' })
  const partyLabel = useWatch({ control: form.control, name: 'partyLabel' })
  const fromOrder = orderId !== ''
  const sameCompany = (started: string | null) =>
    useCompanyStore.getState().activeCompanyId === started

  const changedElsewhere =
    delivery !== null &&
    base !== null &&
    delivery.id === base.id &&
    delivery.version !== base.version

  const save = useMutation({
    mutationFn: async ({ values }: { values: DeliveryValues; company: string | null }) => {
      setLastValues(values)
      if (base) {
        return deliveriesApi.update(base.id, { ...toDeliveryInput(values), version: base.version })
      }
      if (values.orderId) {
        const input = toFromOrderInput(values)
        return deliveriesApi.createFromOrder(
          values.orderId,
          input,
          keyFor({ order: values.orderId, ...input }),
        )
      }
      const input = toDeliveryInput(values)
      return deliveriesApi.create(input, keyFor(input))
    },
    onSuccess: (saved, { company: started }) => {
      const c = started ?? 'none'
      queryClient.setQueryData(salesDocsKeys.detail('deliveries', saved.id, c), saved)
      void queryClient.invalidateQueries({ queryKey: salesDocsKeys.branch('deliveries', c) })
      keyFor.reset()
      if (!sameCompany(started)) return
      setBase(saved)
      form.reset(valuesFromDelivery(saved, remainingByLine(form.getValues())))
    },
    onError: (error, { company: started }) => {
      if (sameCompany(started) && isVersionConflict(error)) setConflict(true)
    },
  })

  const post = useMutation({
    mutationFn: ({ target }: { target: Delivery; company: string | null }) =>
      deliveriesApi.post(target.id, target.version, keyFor({ post: target.id, v: target.version })),
    onSuccess: (posted, { company: started }) => {
      const c = started ?? 'none'
      queryClient.setQueryData(salesDocsKeys.detail('deliveries', posted.id, c), posted)
      invalidateSalesEffects(queryClient, c)
      keyFor.reset()
      if (sameCompany(started)) onPosted(posted)
    },
    onError: (error, { company: started }) => {
      if (sameCompany(started) && isVersionConflict(error)) setConflict(true)
    },
  })

  const remove = useMutation({
    mutationFn: ({ target }: { target: Delivery; company: string | null }) =>
      deliveriesApi.remove(target.id, target.version),
    onSuccess: (_, { company: started }) => {
      void queryClient.invalidateQueries({
        queryKey: salesDocsKeys.branch('deliveries', started ?? 'none'),
      })
      if (!sameCompany(started)) return
      platform.notify.success(t('editor.deleted'))
      void navigate(DELIVERIES_BASE)
    },
    onError: (error, { company: started }) => {
      if (!sameCompany(started)) return
      if (isVersionConflict(error)) setConflict(true)
      else platform.notify.error(errorMessage(error, t('errors.generic')))
    },
  })

  const submitSave = form.handleSubmit(async (values) => {
    const started = company
    try {
      const saved = await save.mutateAsync({ values, company: started })
      if (!sameCompany(started)) return
      platform.notify.success(t('editor.saved'))
      if (!base) void navigate(`${DELIVERIES_BASE}/${saved.id}`, { replace: true })
    } catch {
      // Shown by the summary / conflict alert.
    }
  })

  /** Unsaved changes are saved first; an unchanged stored draft posts with the post permission. */
  const submitPost = form.handleSubmit(async (values) => {
    if ((!base || isDirty) && !canSave) return
    const started = company
    try {
      if (!base) {
        const saved = await save.mutateAsync({ values, company: started })
        if (sameCompany(started))
          void navigate(`${DELIVERIES_BASE}/${saved.id}`, {
            replace: true,
            state: { confirmPost: true },
          })
        return
      }
      if (isDirty) await save.mutateAsync({ values, company: started })
      if (sameCompany(started)) setConfirmPost(true)
    } catch {
      // Shown by the summary / conflict alert.
    }
  })

  /** Posts the stored draft only if nobody changed it since it was loaded. */
  const confirmAndPost = async () => {
    if (!base) return
    const started = company
    setChecking(true)
    try {
      const fresh = await deliveriesApi.get(base.id)
      if (!sameCompany(started)) return
      if (fresh.version !== base.version || fresh.status !== 'draft') {
        setConflict(true)
        throw new Error('changed')
      }
      await post.mutateAsync({ target: fresh, company: started })
    } catch (error) {
      setConfirmPost(false)
      throw error
    } finally {
      setChecking(false)
    }
  }

  const reload = async () => {
    const fresh = await onReload()
    if (fresh) {
      setBase(fresh)
      form.reset(valuesFromDelivery(fresh, remainingByLine(form.getValues())))
    }
    setConflict(false)
    save.reset()
    post.reset()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (canSave && !save.isPending) void submitSave()
    }
  }

  const busy = save.isPending || post.isPending || checking
  const disabled = !canSave || busy
  const actionError = conflict ? null : (save.error ?? post.error)
  const current = base ?? delivery

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6" onKeyDown={onKeyDown}>
      <PageHeader
        title={delivery ? t('delivery.editTitle') : t('delivery.newTitle')}
        description={t('delivery.editorDescription')}
        breadcrumbs={[
          { label: t('nav.sales') },
          { label: t('delivery.listTitle'), to: DELIVERIES_BASE },
          { label: delivery ? t('deliveryStatus.draft') : t('delivery.new') },
        ]}
        meta={delivery ? <DeliveryStatusBadge status={delivery.status} /> : undefined}
        actions={
          <>
            {delivery && canDelete && (
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
                {save.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save aria-hidden="true" />
                )}
                {t('editor.saveDraft')}
              </Button>
            )}
            {canPost && (canSave || delivery) && (
              <Button type="button" disabled={busy} onClick={() => void submitPost()}>
                {post.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCheck aria-hidden="true" />
                )}
                {t('delivery.post')}
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
          mapField={serverFieldMapper(lastValues ?? form.getValues())}
          fieldLabels={{
            partyId: t('fields.customer'),
            documentDate: t('fields.documentDate'),
            warehouseId: t('fields.warehouse'),
            notes: t('fields.notes'),
            lines: t('delivery.lines'),
          }}
        />
        <section
          aria-label={t('editor.header')}
          className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-[1fr_10rem_1fr]"
        >
          {fromOrder ? (
            <div className="space-y-1.5 text-sm">
              <p className="font-medium">{t('fields.customer')}</p>
              <p data-testid="delivery-party">{partyLabel}</p>
              <p className="text-xs text-muted-foreground">
                {t('delivery.fromOrder')}{' '}
                <Link to={linkTo('sales_order', orderId)} className="text-primary hover:underline">
                  {current?.order_number ?? t('delivery.order')}
                </Link>
              </p>
            </div>
          ) : (
            <FormField<DeliveryValues, 'partyId'>
              name="partyId"
              label={t('fields.customer')}
              required
              render={({ field, control }) => (
                <PartyCombobox
                  {...control}
                  ref={field.ref}
                  value={field.value || null}
                  role="customer"
                  disabled={disabled || delivery !== null}
                  initialParty={
                    current
                      ? { id: current.party_id, code: '', name: partyLabel, roles: ['customer'] }
                      : null
                  }
                  onBlur={field.onBlur}
                  onChange={(id, party) => {
                    field.onChange(id ?? '')
                    form.setValue('partyLabel', party?.name ?? '')
                  }}
                />
              )}
            />
          )}
          <FormField<DeliveryValues, 'documentDate'>
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
          <FormField<DeliveryValues, 'warehouseId'>
            name="warehouseId"
            label={t('fields.warehouse')}
            required
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
          <div className="md:col-span-3">
            <FormField<DeliveryValues, 'notes'>
              name="notes"
              label={t('fields.notes')}
              render={({ field, control }) => (
                <Input {...control} {...field} disabled={disabled} maxLength={2000} />
              )}
            />
          </div>
        </section>
        <DeliveryLinesGrid disabled={disabled} fromOrder={fromOrder} />
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </Form>
      {current && (
        <ConfirmDialog
          open={confirmPost}
          onOpenChange={setConfirmPost}
          tone="primary"
          title={t('delivery.postTitle')}
          description={
            <span className="space-y-1">
              <span className="block">{t('delivery.postBody')}</span>
              <span className="block tabular-nums">
                {t('delivery.postSummary', {
                  date: formatDate(current.document_date, locale),
                  count: current.lines.length,
                })}
              </span>
            </span>
          }
          confirmLabel={t('delivery.post')}
          onConfirm={confirmAndPost}
        />
      )}
      {current && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('editor.deleteTitle')}
          description={t('editor.deleteBody')}
          confirmLabel={t('editor.delete')}
          onConfirm={async () => {
            await remove.mutateAsync({ target: current, company })
          }}
        />
      )}
    </div>
  )
}

/** Remaining order quantities by order line, kept across saves (the API does not echo them). */
function remainingByLine(values: DeliveryValues): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { line } of sentLines(values)) {
    if (line.sourceLineId && line.remaining) out[line.sourceLineId] = line.remaining
  }
  for (const line of values.lines) {
    if (line.sourceLineId && line.remaining && !(line.sourceLineId in out))
      out[line.sourceLineId] = line.remaining
  }
  return out
}
