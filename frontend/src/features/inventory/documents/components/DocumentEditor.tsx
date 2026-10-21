import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, Loader2, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useForm, useFormState, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DateInput, Form, FormErrorSummary, FormField } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { documentsApi, lookupsApi, type BarcodeHit } from '../api/client'
import { invDocsKeys } from '../api/keys'
import { useWarehouses } from '../hooks/queries'
import { errorMessage, isVersionConflict } from '../lib/errors'
import { usePayloadKeys } from '../lib/idempotency'
import {
  emptyDocument,
  emptyLine,
  isBlankLine,
  serverFieldMapper,
  toDocInput,
  toDocValues,
  typeRules,
  withBaseUnit,
  type DocValues,
} from '../lib/lines'
import { dec } from '../lib/quantity'
import { selectClass } from '../lib/ui'
import { INV_PERMS } from '../permissions'
import { docSchema, type DocMessages } from '../schemas'
import { EDITABLE_DOC_TYPES, MAX_LINES, type EditableDocType, type StockDocument } from '../types'
import { BarcodeScanInput } from './BarcodeScanInput'
import { DocStatusBadge } from './DocStatusBadge'
import { WarehouseSelect } from './pickers'
import { StockLinesGrid } from './StockLinesGrid'
import { VersionConflictAlert } from './VersionConflictAlert'

interface DocumentEditorProps {
  /** null for a new document. */
  document: StockDocument | null
  /** Type of a new document (from the URL). */
  initialType?: EditableDocType
  onReload: () => Promise<StockDocument | undefined>
  onPosted: (doc: StockDocument) => void
}

export const DOCS_BASE = '/inventory/documents'

/** Draft editor: save (POST / PATCH with version), post with confirmation, delete draft. */
export function DocumentEditor({
  document,
  initialType = 'receipt',
  onReload,
  onPosted,
}: DocumentEditorProps) {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const canEdit = usePermission(INV_PERMS.documents.create)
  const canPost = usePermission(INV_PERMS.documents.post)
  const warehouses = useWarehouses()
  const defaultWarehouse = warehouses.data?.find((w) => w.is_default && w.is_active)?.id ?? ''
  const [conflict, setConflict] = useState(false)
  const [base, setBase] = useState<StockDocument | null>(document)
  const [confirmPost, setConfirmPost] = useState(
    () =>
      (location.state as { confirmPost?: boolean } | null)?.confirmPost === true &&
      document !== null,
  )
  const [checking, setChecking] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lastValues, setLastValues] = useState<DocValues | null>(null)
  const company = useCompanyStore((s) => s.activeCompanyId)

  const messages: DocMessages = useMemo(
    () => ({
      warehouse: t('validation.warehouse'),
      targetWarehouse: t('validation.targetWarehouse'),
      sameWarehouse: t('validation.sameWarehouse'),
      minLines: t('validation.minLines'),
      maxLines: t('validation.maxLines', { max: MAX_LINES }),
      tooLong: t('validation.tooLong'),
      item: t('validation.item'),
      unit: t('validation.unit'),
      quantity: t('validation.quantity'),
      quantityPositive: t('validation.quantityPositive'),
      quantityNonZero: t('validation.quantityNonZero'),
      unitCost: t('validation.unitCost'),
      lot: t('validation.lot'),
      expiry: t('validation.expiry'),
      serialCount: (count, quantity) => t('validation.serialCount', { count, quantity }),
      serialInteger: t('validation.serialInteger'),
      serialDuplicate: (serial) => t('validation.serialDuplicate', { serial }),
    }),
    [t],
  )
  const form = useForm<DocValues>({
    resolver: zodResolver(docSchema(messages)),
    defaultValues: document ? toDocValues(document) : emptyDocument(initialType),
  })
  const { isDirty } = useFormState({ control: form.control })
  const docType = useWatch({ control: form.control, name: 'docType' })
  const warehouseId = useWatch({ control: form.control, name: 'warehouseId' })
  const rules = typeRules(docType)

  // The company default warehouse fills an untouched new document once the list arrives.
  useEffect(() => {
    if (!document && defaultWarehouse && form.getValues('warehouseId') === '') {
      form.setValue('warehouseId', defaultWarehouse)
    }
  }, [document, defaultWarehouse, form])

  const changedElsewhere =
    document !== null &&
    base !== null &&
    document.id === base.id &&
    document.version !== base.version

  const sameCompany = (started: string | null) =>
    useCompanyStore.getState().activeCompanyId === started

  const save = useMutation({
    mutationFn: async ({ values }: { values: DocValues; company: string | null }) => {
      setLastValues(values)
      const input = toDocInput(values)
      return base
        ? documentsApi.update(base.id, { ...input, version: base.version })
        : documentsApi.create(input, keyFor(input))
    },
    onSuccess: (saved, { company: started }) => {
      queryClient.setQueryData(invDocsKeys.document(saved.id, started ?? 'none'), saved)
      void queryClient.invalidateQueries({ queryKey: invDocsKeys.documents(started ?? 'none') })
      if (!sameCompany(started)) return
      setBase(saved)
      form.reset(toDocValues(saved))
    },
    onError: (error, { company: started }) => {
      if (sameCompany(started) && isVersionConflict(error)) setConflict(true)
    },
  })

  const post = useMutation({
    mutationFn: ({ target }: { target: StockDocument; company: string | null }) =>
      documentsApi.post(
        target.id,
        target.version,
        keyFor({ post: target.id, version: target.version }),
      ),
    onSuccess: (posted, { company: started }) => {
      queryClient.setQueryData(invDocsKeys.document(posted.id, started ?? 'none'), posted)
      void queryClient.invalidateQueries({ queryKey: invDocsKeys.documents(started ?? 'none') })
      if (sameCompany(started)) onPosted(posted)
    },
    onError: (error, { company: started }) => {
      if (sameCompany(started) && isVersionConflict(error)) setConflict(true)
    },
  })

  const remove = useMutation({
    mutationFn: ({ target }: { target: StockDocument; company: string | null }) =>
      documentsApi.remove(target.id, target.version),
    onSuccess: (_, { company: started }) => {
      void queryClient.invalidateQueries({ queryKey: invDocsKeys.documents(started ?? 'none') })
      if (!sameCompany(started)) return
      platform.notify.success(t('editor.deleted'))
      void navigate(DOCS_BASE)
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
      if (!base) void navigate(`${DOCS_BASE}/${saved.id}`, { replace: true })
    } catch {
      // Shown by the summary / conflict alert.
    }
  })

  /**
   * Unsaved changes are saved first (create permission); posting an unchanged stored draft
   * needs only the post permission.
   */
  const submitPost = form.handleSubmit(async (values) => {
    if ((!base || isDirty) && !canEdit) return
    const started = company
    try {
      if (!base) {
        const saved = await save.mutateAsync({ values, company: started })
        if (sameCompany(started))
          void navigate(`${DOCS_BASE}/${saved.id}`, { replace: true, state: { confirmPost: true } })
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
      const fresh = await documentsApi.get(base.id)
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

  /** A scanned barcode adds its item (or one more of an untracked line already on the document). */
  const onScan = async (hit: BarcodeHit) => {
    const units = await queryClient
      .query({
        queryKey: invDocsKeys.itemUnits(hit.item.id),
        queryFn: ({ signal }) => lookupsApi.itemUnits(hit.item, signal),
        staleTime: 5 * 60_000,
      })
      .catch(() => [])
    const unit = units.find((u) => u.unit_id === hit.unitId)
    const item = withBaseUnit(hit.item, units)
    const current = form.getValues('lines')
    const label = `${hit.item.code} · ${hit.item.name}`
    const same = current.findIndex(
      (l) => l.itemId === hit.item.id && l.unitId === hit.unitId && hit.item.tracking === 'none',
    )
    if (same >= 0) {
      const next = dec(current[same]?.quantity).plus(1).toString()
      form.setValue(`lines.${same}.quantity`, next, { shouldDirty: true })
      platform.notify.success(t('scan.incremented', { item: label }))
      return
    }
    if (current.length >= MAX_LINES) {
      platform.notify.warning(t('lines.maxReached', { max: MAX_LINES }))
      return
    }
    const line = {
      ...emptyLine(),
      itemId: item.id,
      item,
      unitId: hit.unitId,
      unitCode: unit?.code ?? hit.item.base_unit?.code ?? '',
      factor: unit?.factor ?? '1',
      quantity: '1',
    }
    const blank = current.findIndex(isBlankLine)
    const lines = [...current]
    if (blank >= 0) lines[blank] = line
    else lines.push(line)
    form.setValue('lines', lines, { shouldDirty: true })
    platform.notify.success(t('scan.added', { item: label }))
  }

  const reload = async () => {
    const fresh = await onReload()
    if (fresh) {
      setBase(fresh)
      form.reset(toDocValues(fresh))
    }
    setConflict(false)
    save.reset()
    post.reset()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (canEdit && !save.isPending) void submitSave()
    }
  }

  const disabled = !canEdit || save.isPending || post.isPending
  const busy = save.isPending || post.isPending || checking
  const actionError = conflict ? null : (save.error ?? post.error)
  const typeLabel = t(`docType.${docType}`)
  const warehouseLabel = (id: string) => {
    const w = warehouses.data?.find((x) => x.id === id)
    return w ? `${w.code} · ${w.name}` : ''
  }

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6" onKeyDown={onKeyDown}>
      <PageHeader
        title={
          document
            ? t('editor.editTitle', { type: typeLabel })
            : t('editor.newTitle', { type: typeLabel })
        }
        description={t('editor.description')}
        breadcrumbs={[
          { label: t('nav.inventory') },
          { label: t('list.title'), to: DOCS_BASE },
          { label: document ? t('status.draft') : t('list.new') },
        ]}
        meta={document ? <DocStatusBadge status={document.status} /> : undefined}
        actions={
          <>
            {document && canEdit && (
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
            {canEdit && (
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
            {canPost && (canEdit || document) && (
              <Button type="button" disabled={busy} onClick={() => void submitPost()}>
                {post.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCheck aria-hidden="true" />
                )}
                {t('editor.post')}
              </Button>
            )}
          </>
        }
      />
      <Form form={form} onSubmit={() => void submitSave()} className="space-y-4">
        {conflict && <VersionConflictAlert onReload={() => void reload()} />}
        {!conflict && changedElsewhere && <VersionConflictAlert onReload={() => void reload()} />}
        {!canEdit && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('editor.readOnly')}
          </p>
        )}
        <FormErrorSummary
          error={actionError}
          mapField={serverFieldMapper(lastValues ?? form.getValues())}
          fieldLabels={{
            docType: t('fields.docType'),
            documentDate: t('fields.documentDate'),
            warehouseId: t('fields.warehouse'),
            targetWarehouseId: t('fields.targetWarehouse'),
            reason: t('fields.reason'),
            notes: t('fields.notes'),
          }}
        />
        <section
          aria-label={t('editor.header')}
          className="grid gap-4 rounded-lg border border-border bg-surface p-4 md:grid-cols-[10rem_10rem_1fr_1fr]"
        >
          <FormField<DocValues, 'docType'>
            name="docType"
            label={t('fields.docType')}
            required
            render={({ field, control }) => (
              <select
                {...control}
                ref={field.ref}
                name={field.name}
                value={field.value}
                // The type of a stored draft is fixed (its number sequence and rules follow it).
                disabled={disabled || document !== null}
                className={selectClass}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
              >
                {EDITABLE_DOC_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`docType.${type}`)}
                  </option>
                ))}
              </select>
            )}
          />
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
          <FormField<DocValues, 'warehouseId'>
            name="warehouseId"
            label={rules.target ? t('fields.sourceWarehouse') : t('fields.warehouse')}
            required
            render={({ field, control }) => (
              <WarehouseSelect
                {...control}
                ref={field.ref}
                value={field.value}
                disabled={disabled}
                onBlur={field.onBlur}
                onChange={(v) => {
                  field.onChange(v)
                  // Locations belong to the old warehouse.
                  form
                    .getValues('lines')
                    .forEach((_, i) =>
                      form.setValue(`lines.${i}.locationId`, '', { shouldDirty: true }),
                    )
                }}
              />
            )}
          />
          {rules.target ? (
            <FormField<DocValues, 'targetWarehouseId'>
              name="targetWarehouseId"
              label={t('fields.targetWarehouse')}
              required
              render={({ field, control }) => (
                <WarehouseSelect
                  {...control}
                  ref={field.ref}
                  value={field.value}
                  exclude={warehouseId}
                  disabled={disabled}
                  onBlur={field.onBlur}
                  onChange={(v) => {
                    field.onChange(v)
                    form
                      .getValues('lines')
                      .forEach((_, i) =>
                        form.setValue(`lines.${i}.targetLocationId`, '', { shouldDirty: true }),
                      )
                  }}
                />
              )}
            />
          ) : (
            <FormField<DocValues, 'reason'>
              name="reason"
              label={t('fields.reason')}
              render={({ field, control }) => (
                <Input {...control} {...field} disabled={disabled} maxLength={500} />
              )}
            />
          )}
          <div className="md:col-span-4">
            <FormField<DocValues, 'notes'>
              name="notes"
              label={t('fields.notes')}
              render={({ field, control }) => (
                <Input {...control} {...field} disabled={disabled} maxLength={2000} />
              )}
            />
          </div>
        </section>
        {canEdit && (
          <div className="flex flex-wrap items-end gap-3">
            <BarcodeScanInput disabled={disabled} onHit={(hit) => void onScan(hit)} />
          </div>
        )}
        <StockLinesGrid disabled={disabled} />
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </Form>
      {document && (
        <ConfirmDialog
          open={confirmPost}
          onOpenChange={setConfirmPost}
          tone="primary"
          title={t('post.title')}
          description={
            <span className="space-y-1">
              <span className="block">{t('post.body')}</span>
              <span className="block tabular-nums">
                {t('post.summary', {
                  date: formatDate(base?.document_date ?? document.document_date, locale),
                  count: (base ?? document).lines.length,
                  warehouse: warehouseLabel((base ?? document).warehouse_id),
                })}
              </span>
            </span>
          }
          confirmLabel={t('post.confirm')}
          onConfirm={confirmAndPost}
        />
      )}
      {document && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('editor.deleteTitle')}
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
