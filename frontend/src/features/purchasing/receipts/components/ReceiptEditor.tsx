import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ban, Loader2, PackageCheck, Save, Trash2 } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { useForm, useFormState, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DateInput, Form, FormErrorSummary, FormField } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PartyCombobox } from '@/features/parties'
import { CurrencySelect, WarehouseSelect } from '@/features/reference'
import { VersionConflictAlert } from '@/features/sales/shared/components/common'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { createKeys } from '../../invoices/kit/createKeys'
import { DocLinks } from '../../invoices/kit/components/DocLinks'
import { ReceiptStatusBadge } from '../../invoices/kit/components/StatusBadges'
import { SupplierExposureBadge } from '../../invoices/kit/components/SupplierExposureBadge'
import { errorMessage, isVersionConflict } from '../../invoices/kit/http'
import { purchKeys } from '../../invoices/kit/keys'
import { ORDERS_BASE, RECEIPTS_BASE } from '../../invoices/kit/links'
import { PURCH_PERMS, saveDraftPermission } from '../../invoices/kit/permissions'
import { MAX_LINES } from '../../invoices/kit/types'
import { receiptsApi } from '../api'
import {
  sentReceiptLines,
  toFromOrderInput,
  toReceiptInput,
  valuesFromReceipt,
  type ReceiptValues,
} from '../lib/lines'
import { receiptFieldMapper, receiptSchema, type ReceiptMessages } from '../lib/schema'
import type { OrderSource, Receipt } from '../types'
import { CancelReceiptDialog } from './CancelReceiptDialog'
import { PostReceiptDialog } from './PostReceiptDialog'
import { ReceiptLinesGrid } from './ReceiptLinesGrid'

interface ReceiptEditorProps {
  receipt: Receipt | null
  /** The order a receipt is created from or belongs to (lines, remaining quantities). */
  order: OrderSource | null
  initialValues: ReceiptValues
  onReload: () => Promise<Receipt | undefined>
  onPosted: (receipt: Receipt) => void
}

/**
 * Draft goods receipt: date, warehouse and supplier reference; per line the received quantity
 * with lot, expiry and serials; save and post (stock at order cost, GRNI accrual).
 */
export function ReceiptEditor({
  receipt,
  order,
  initialValues,
  onReload,
  onPosted,
}: ReceiptEditorProps) {
  const { t } = useTranslation('purchasing-docs')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const canSave = usePermission(saveDraftPermission('receipts', receipt !== null))
  const canPost = usePermission(PURCH_PERMS.receipts.post)
  const canDelete = usePermission(PURCH_PERMS.receipts.delete)
  const canCancel = usePermission(PURCH_PERMS.receipts.update)
  const company = useCompanyStore((s) => s.activeCompanyId)
  const [base, setBase] = useState<Receipt | null>(receipt)
  const [conflict, setConflict] = useState(false)
  const [posting, setPosting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lastSent, setLastSent] = useState<number[]>([])
  const direct = initialValues.orderId === ''

  const messages: ReceiptMessages = useMemo(
    () => ({
      party: t('validation.supplier'),
      warehouse: t('validation.warehouse'),
      minLines: t('validation.minReceiptLines'),
      maxLines: t('validation.maxLines', { max: MAX_LINES }),
      tooLong: t('validation.tooLong'),
      item: t('validation.item'),
      unit: t('validation.unit'),
      quantity: t('validation.quantityPositive'),
      price: t('validation.price'),
      lot: t('validation.lot'),
      expiry: t('validation.expiry'),
      serialCount: t('validation.serialCount'),
      serialDuplicate: t('validation.serialDuplicateShort'),
    }),
    [t],
  )
  const form = useForm<ReceiptValues>({
    resolver: zodResolver(receiptSchema(messages)),
    defaultValues: initialValues,
  })
  const { isDirty } = useFormState({ control: form.control })
  const values = useWatch({ control: form.control }) as ReceiptValues
  const sameCompany = (started: string | null) =>
    useCompanyStore.getState().activeCompanyId === started
  const changedElsewhere =
    receipt !== null && base !== null && receipt.id === base.id && receipt.version !== base.version

  const save = useMutation({
    mutationFn: ({ values: v, company: c }: { values: ReceiptValues; company: string | null }) => {
      setLastSent(sentReceiptLines(v).map(({ index }) => index))
      if (base) return receiptsApi.update(base.id, { ...toReceiptInput(v), version: base.version })
      if (v.orderId) {
        const input = toFromOrderInput(v)
        return receiptsApi.createFromOrder(
          v.orderId,
          input,
          createKeys.keyFor(c ?? 'none', `receipt-from-order:${v.orderId}`, input),
        )
      }
      const input = toReceiptInput(v)
      return receiptsApi.create(input, createKeys.keyFor(c ?? 'none', 'receipt', input))
    },
    onSuccess: (saved, { values: sent, company: started }) => {
      const c = started ?? 'none'
      queryClient.setQueryData(purchKeys.detail('receipts', saved.id, c), saved)
      void queryClient.invalidateQueries({ queryKey: purchKeys.branch('receipts', c) })
      if (sent.orderId)
        createKeys.release(c, `receipt-from-order:${sent.orderId}`, toFromOrderInput(sent))
      else createKeys.release(c, 'receipt', toReceiptInput(sent))
      if (!sameCompany(started)) return
      setBase(saved)
      form.reset(valuesFromReceipt(saved, order))
    },
    onError: (error, { company: started }) => {
      if (sameCompany(started) && isVersionConflict(error)) setConflict(true)
    },
  })

  const remove = useMutation({
    mutationFn: ({ target }: { target: Receipt; company: string | null }) =>
      receiptsApi.remove(target.id, target.version),
    onSuccess: (_, { company: started }) => {
      void queryClient.invalidateQueries({
        queryKey: purchKeys.branch('receipts', started ?? 'none'),
      })
      if (!sameCompany(started)) return
      platform.notify.success(t('editor.deleted'))
      void navigate(RECEIPTS_BASE)
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
      if (!base) void navigate(`${RECEIPTS_BASE}/${saved.id}`, { replace: true })
    } catch {
      // Shown by the summary / conflict alert.
    }
  })

  const submitPost = form.handleSubmit(async (v) => {
    const started = company
    try {
      if (!base || isDirty) {
        if (!canSave) return
        const saved = await save.mutateAsync({ values: v, company: started })
        if (!base && sameCompany(started)) {
          void navigate(`${RECEIPTS_BASE}/${saved.id}`, { replace: true })
          return
        }
      }
      if (sameCompany(started)) setPosting(true)
    } catch {
      // Shown by the summary / conflict alert.
    }
  })

  const reload = async () => {
    const latest = await onReload()
    if (latest) {
      setBase(latest)
      form.reset(valuesFromReceipt(latest, order))
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
  const orderNumber = order?.number ?? null

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6" onKeyDown={onKeyDown}>
      <PageHeader
        title={receipt ? t('receipt.editTitle') : t('receipt.newTitle')}
        description={direct ? t('receipt.directDescription') : t('receipt.editorDescription')}
        breadcrumbs={[
          { label: t('nav.purchasing') },
          { label: t('receipt.listTitle'), to: RECEIPTS_BASE },
          { label: receipt ? t('receiptStatus.draft') : t('receipt.new') },
        ]}
        meta={receipt ? <ReceiptStatusBadge status={receipt.status} /> : undefined}
        actions={
          <>
            {receipt && canDelete && (
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
            {receipt && canCancel && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setCancelling(true)}
              >
                <Ban aria-hidden="true" />
                {t('receipt.cancel')}
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
            {canPost && (canSave || receipt) && (
              <Button type="button" disabled={busy} onClick={() => void submitPost()}>
                <PackageCheck aria-hidden="true" />
                {t('receipt.post')}
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
          error={conflict ? null : save.error}
          mapField={receiptFieldMapper(lastSent)}
          fieldLabels={{
            partyId: t('fields.supplier'),
            documentDate: t('fields.documentDate'),
            warehouseId: t('fields.warehouse'),
            supplierReference: t('fields.supplierReference'),
            notes: t('fields.notes'),
            lines: t('receipt.lines'),
          }}
        />
        <section
          aria-label={t('editor.header')}
          className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-4"
        >
          <div className="md:col-span-2">
            {direct ? (
              <FormField<ReceiptValues, 'partyId'>
                name="partyId"
                label={t('fields.supplier')}
                required
                render={({ field, control }) => (
                  <PartyCombobox
                    {...control}
                    ref={field.ref}
                    value={field.value || null}
                    role="supplier"
                    disabled={disabled}
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
                    }}
                  />
                )}
              />
            ) : (
              <div className="space-y-1 text-sm">
                <p className="text-xs text-muted-foreground">{t('fields.supplier')}</p>
                <p className="font-medium">{values.partyLabel}</p>
                {order && (
                  <p className="text-xs">
                    {t('receipt.forOrder')}{' '}
                    <Link
                      to={`${ORDERS_BASE}/${encodeURIComponent(order.id)}`}
                      className="font-code text-primary hover:underline"
                    >
                      {orderNumber ?? t('links.unnumbered')}
                    </Link>
                  </p>
                )}
              </div>
            )}
            {values.partyId && <SupplierExposureBadge partyId={values.partyId} />}
          </div>
          <FormField<ReceiptValues, 'documentDate'>
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
          <FormField<ReceiptValues, 'warehouseId'>
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
          {direct && (
            <FormField<ReceiptValues, 'currencyCode'>
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
          )}
          <FormField<ReceiptValues, 'supplierReference'>
            name="supplierReference"
            label={t('fields.supplierReference')}
            description={t('receipt.supplierReferenceHint')}
            render={({ field, control }) => (
              <Input
                {...control}
                {...field}
                disabled={disabled}
                maxLength={100}
                autoComplete="off"
              />
            )}
          />
          <div className={direct ? 'md:col-span-2' : 'md:col-span-3'}>
            <FormField<ReceiptValues, 'notes'>
              name="notes"
              label={t('fields.notes')}
              render={({ field, control }) => (
                <Input {...control} {...field} disabled={disabled} maxLength={5000} />
              )}
            />
          </div>
        </section>
        <ReceiptLinesGrid disabled={disabled} direct={direct} />
        <DocLinks links={base?.links} />
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </Form>
      {base && (
        <PostReceiptDialog
          receipt={base}
          open={posting}
          onOpenChange={setPosting}
          onPosted={onPosted}
          onReload={() => void reload()}
        />
      )}
      {base && (
        <CancelReceiptDialog
          receipt={base}
          open={cancelling}
          onOpenChange={setCancelling}
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
