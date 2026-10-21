import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { Form, FormErrorSummary, FormField } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isApiError, platform } from '@/platform'
import { usePermission } from '@/lib/permissions'
import { itemsApi } from '../api/client'
import { catalogKeys } from '../api/keys'
import { AttributeEditor } from '../components/AttributeEditor'
import { CheckboxField, DecimalField, SelectField, TextField } from '../components/fields'
import { BarcodesTab } from '../components/item/BarcodesTab'
import { ItemUnitsTab } from '../components/item/ItemUnitsTab'
import { VariantsTab } from '../components/item/VariantsTab'
import { CategorySelect, TaxCodeCombobox, UnitSelect } from '../components/pickers'
import { VersionConflictAlert } from '../components/VersionConflictAlert'
import { useIdempotencyKey, useInvalidate, useItem } from '../hooks/queries'
import { errorMessage, isVersionConflict } from '../lib/errors'
import { itemDefaults, itemSchema, toItemInput, type ItemValues } from '../schemas'
import { ITEM_TYPES, TRACKING_MODES, type Item } from '../types'

const TABS = ['general', 'variants', 'barcodes', 'units'] as const
type Tab = (typeof TABS)[number]

export function ItemFormPage() {
  const { id } = useParams()
  const { t } = useTranslation('catalog')
  const item = useItem(id)
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = TABS.find((x) => x === raw) ?? 'general'
  const title = id ? (item.data ? item.data.name : t('items.editTitle')) : t('items.newTitle')

  const setTab = (next: string) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        if (next === 'general') out.delete('tab')
        else out.set('tab', next)
        return out
      },
      { replace: true },
    )

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: t('nav.catalog') },
          { label: t('items.title'), to: '/catalog/items' },
          { label: id ? (item.data?.code ?? '…') : t('items.newTitle') },
        ]}
        meta={
          item.data ? (
            <>
              <span className="font-code text-sm text-muted-foreground">{item.data.code}</span>
              <StatusBadge status={item.data.is_active ? 'active' : 'inactive'} />
            </>
          ) : undefined
        }
      />
      {id && item.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : id && item.isError ? (
        <EmptyState
          title={
            isApiError(item.error) && item.error.status === 404
              ? t('items.notFound')
              : t('errors.loadFailed')
          }
          action={
            <Button variant="secondary" onClick={() => void item.refetch()}>
              {t('actions.retry')}
            </Button>
          }
        />
      ) : (
        <Tabs value={id ? tab : 'general'} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="general">{t('items.tabs.general')}</TabsTrigger>
            <TabsTrigger value="variants" disabled={!id}>
              {t('items.tabs.variants')}
            </TabsTrigger>
            <TabsTrigger value="barcodes" disabled={!id}>
              {t('items.tabs.barcodes')}
            </TabsTrigger>
            <TabsTrigger value="units" disabled={!id}>
              {t('items.tabs.units')}
            </TabsTrigger>
          </TabsList>
          {!id && <p className="pt-2 text-xs text-muted-foreground">{t('items.saveFirst')}</p>}
          {/* Kept mounted so unsaved edits survive a visit to another tab. */}
          <TabsContent value="general" forceMount className="data-[state=inactive]:hidden">
            <GeneralForm key={item.data?.id ?? 'new'} item={item.data} />
          </TabsContent>
          {item.data && (
            <>
              <TabsContent value="variants">
                <VariantsTab item={item.data} />
              </TabsContent>
              <TabsContent value="barcodes">
                <BarcodesTab item={item.data} />
              </TabsContent>
              <TabsContent value="units">
                <ItemUnitsTab item={item.data} />
              </TabsContent>
            </>
          )}
        </Tabs>
      )}
    </div>
  )
}

function GeneralForm({ item }: { item: Item | undefined }) {
  const { t } = useTranslation('catalog')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const invalidate = useInvalidate()
  const idem = useIdempotencyKey()
  const canEdit = usePermission(item ? 'items.update' : 'items.create')
  const canDelete = usePermission('items.delete')
  const [base, setBase] = useState(item)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const form = useForm<ItemValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: itemDefaults(item),
  })
  const type = useWatch({ control: form.control, name: 'type' })
  const isService = type === 'service'

  const save = useMutation({
    mutationFn: (v: ItemValues) => {
      const input = toItemInput(v)
      return base
        ? itemsApi.update(base.id, { ...input, version: base.version })
        : itemsApi.create(input, idem.current(input))
    },
    onSuccess: async (saved) => {
      idem.reset()
      queryClient.setQueryData(catalogKeys.item(saved.id), saved)
      await invalidate(catalogKeys.items())
      platform.notify.success(t('toast.saved'))
      if (!base) {
        void navigate(`/catalog/items/${saved.id}`, { replace: true })
      } else {
        setBase(saved)
        form.reset(itemDefaults(saved))
      }
    },
  })

  const remove = useMutation({
    mutationFn: () => itemsApi.remove(base?.id ?? ''),
    onSuccess: async () => {
      platform.notify.success(t('items.deleted'))
      await invalidate(catalogKeys.items())
      void navigate('/catalog/items')
    },
    onError: (e) => platform.notify.error(errorMessage(e, t('errors.deleteFailed'))),
  })

  const reload = async () => {
    if (!base) return
    const fresh = await itemsApi.get(base.id)
    queryClient.setQueryData(catalogKeys.item(fresh.id), fresh)
    save.reset()
    setBase(fresh)
    form.reset(itemDefaults(fresh))
  }

  const labels: Record<string, string> = {
    name: t('fields.name'),
    type: t('fields.type'),
    base_unit_id: t('fields.baseUnit'),
    category_id: t('fields.category'),
    default_tax_code_id: t('fields.defaultTaxCode'),
    purchase_tax_code_id: t('fields.purchaseTaxCode'),
    tracking: t('fields.tracking'),
    has_expiry: t('fields.hasExpiry'),
    min_stock: t('fields.minStock'),
    reorder_point: t('fields.reorderPoint'),
    attributes: t('fields.attributes'),
  }

  return (
    <Form form={form} onSubmit={(v) => save.mutate(v)} className="space-y-5">
      {isVersionConflict(save.error) ? (
        <VersionConflictAlert onReload={() => void reload()} />
      ) : (
        <FormErrorSummary error={save.error} fieldLabels={labels} />
      )}
      <fieldset disabled={!canEdit || save.isPending} className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">{t('items.tabs.general')}</legend>
        <TextField<ItemValues, 'name'>
          name="name"
          label={labels.name ?? ''}
          required
          className="sm:col-span-2"
          input={{ autoFocus: !item, maxLength: 200 }}
        />
        <SelectField<ItemValues, 'type'>
          name="type"
          label={labels.type ?? ''}
          required
          options={ITEM_TYPES.map((v) => ({ value: v, label: t(`itemType.${v}`) }))}
        />
        <FormField<ItemValues, 'base_unit_id'>
          name="base_unit_id"
          label={labels.base_unit_id ?? ''}
          required
          description={base ? t('items.baseUnitLocked') : undefined}
          render={({ field, control }) => (
            <UnitSelect
              {...control}
              ref={field.ref}
              value={field.value || null}
              onChange={(v) => field.onChange(v ?? '')}
              onBlur={field.onBlur}
              disabled={Boolean(base)}
            />
          )}
        />
        <FormField<ItemValues, 'category_id'>
          name="category_id"
          label={labels.category_id ?? ''}
          className="sm:col-span-2"
          render={({ field, control }) => (
            <CategorySelect
              {...control}
              ref={field.ref}
              value={field.value || null}
              onChange={(v) => field.onChange(v ?? '')}
              onBlur={field.onBlur}
              clearable
            />
          )}
        />
        <FormField<ItemValues, 'default_tax_code_id'>
          name="default_tax_code_id"
          label={labels.default_tax_code_id ?? ''}
          description={t('items.taxHelp')}
          render={({ field, control }) => (
            <TaxCodeCombobox
              {...control}
              ref={field.ref}
              value={field.value || null}
              onChange={(v) => field.onChange(v ?? '')}
              onBlur={field.onBlur}
            />
          )}
        />
        <FormField<ItemValues, 'purchase_tax_code_id'>
          name="purchase_tax_code_id"
          label={labels.purchase_tax_code_id ?? ''}
          render={({ field, control }) => (
            <TaxCodeCombobox
              {...control}
              ref={field.ref}
              value={field.value || null}
              onChange={(v) => field.onChange(v ?? '')}
              onBlur={field.onBlur}
            />
          )}
        />
        <SelectField<ItemValues, 'tracking'>
          name="tracking"
          label={labels.tracking ?? ''}
          disabled={isService}
          description={isService ? t('items.serviceNoStock') : undefined}
          options={TRACKING_MODES.map((v) => ({ value: v, label: t(`tracking.${v}`) }))}
        />
        <div className="flex items-end pb-2">
          <CheckboxField<ItemValues, 'has_expiry'>
            name="has_expiry"
            label={labels.has_expiry ?? ''}
            disabled={isService}
          />
        </div>
        <DecimalField<ItemValues, 'min_stock'>
          name="min_stock"
          label={labels.min_stock ?? ''}
          scale={6}
          disabled={isService}
        />
        <DecimalField<ItemValues, 'reorder_point'>
          name="reorder_point"
          label={labels.reorder_point ?? ''}
          scale={6}
          disabled={isService}
        />
        <CheckboxField<ItemValues, 'is_active'>
          name="is_active"
          label={t('fields.isActive')}
          description={t('items.activeHelp')}
          className="sm:col-span-2"
        />
        <div className="sm:col-span-2">
          <AttributeEditor<ItemValues> name="attributes" label={labels.attributes ?? ''} />
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {canEdit && (
          <Button type="submit" disabled={save.isPending || isVersionConflict(save.error)}>
            {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {t('actions.save')}
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={() => void navigate('/catalog/items')}>
          {t('actions.back')}
        </Button>
        {base && canDelete && (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto text-danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden="true" />
            {t('actions.delete')}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('items.deleteTitle')}
        description={t('items.deleteBody', { name: base?.name ?? '' })}
        confirmLabel={t('actions.delete')}
        onConfirm={async () => {
          await remove.mutateAsync()
        }}
      />
    </Form>
  )
}
