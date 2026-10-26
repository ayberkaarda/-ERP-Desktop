import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Snowflake, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { DateInput, FieldShell, Form, FormErrorSummary, FormField } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { toIsoDate } from '@/lib/datetime'
import { calendarDate, snakeToCamelPath } from '@/lib/forms'
import { useCompanyStore } from '@/stores/company'
import { ItemCombobox, type Item } from '@/features/catalog'
import { documentsApi } from '../../documents/api/client'
import { invDocsKeys } from '../../documents/api/keys'
import { WarehouseSelect } from '../../documents/components/pickers'
import { useEnrich } from '../../documents/hooks/queries'
import { usePayloadKeys } from '../../documents/lib/idempotency'
import { MAX_LINES, type CountStartInput } from '../../documents/types'
import { useStockWarehouses } from '../../shared/warehouses'
import { COUNTS_PATH } from '../components/CountEditor'

interface StartValues {
  documentDate: string
  warehouseId: string
  freeze: boolean
  notes: string
}

/**
 * Starts a count. With "freeze" the warehouse's non-zero balances (optionally only some items)
 * become the count's lines with their system quantity; without it the count starts empty and
 * lines are added while counting.
 */
export function CountStartPage() {
  const { t } = useTranslation('inventoryDocs')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const enrich = useEnrich()
  const warehouses = useStockWarehouses()
  const [items, setItems] = useState<{ id: string; label: string }[]>([])
  const schema = z.object({
    documentDate: calendarDate(),
    warehouseId: z.string().min(1, t('validation.warehouse')),
    freeze: z.boolean(),
    notes: z.string().max(2000, t('validation.tooLong')),
  })
  const form = useForm<StartValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      documentDate: toIsoDate(new Date()),
      warehouseId: '',
      freeze: true,
      notes: '',
    },
  })
  const freeze = useWatch({ control: form.control, name: 'freeze' })
  const defaultWarehouse = warehouses.data?.find((w) => w.is_default && w.is_active)?.id ?? ''
  useEffect(() => {
    if (defaultWarehouse && form.getValues('warehouseId') === '')
      form.setValue('warehouseId', defaultWarehouse)
  }, [defaultWarehouse, form])

  const start = useMutation({
    mutationFn: async ({ v, company }: { v: StartValues; company: string | null }) => {
      const input: CountStartInput = {
        doc_type: 'count',
        document_date: v.documentDate,
        warehouse_id: v.warehouseId,
        freeze: v.freeze,
        ...(v.freeze && items.length > 0 ? { item_ids: items.map((i) => i.id) } : {}),
        notes: v.notes.trim() || null,
      }
      return enrich(await documentsApi.startCount(input, keyFor(input)), company ?? 'none')
    },
    onSuccess: (doc, { company }) => {
      queryClient.setQueryData(invDocsKeys.document(doc.id, company ?? 'none'), doc)
      void queryClient.invalidateQueries({ queryKey: invDocsKeys.documents(company ?? 'none') })
      if (useCompanyStore.getState().activeCompanyId === company)
        void navigate(`${COUNTS_PATH}/${doc.id}`, { replace: true })
    },
  })

  const addItem = (id: string | null, item?: Item | null) => {
    if (!id || items.some((i) => i.id === id) || items.length >= MAX_LINES) return
    setItems((prev) => [...prev, { id, label: item ? `${item.code} · ${item.name}` : id }])
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <PageHeader
        title={t('count.startTitle')}
        description={t('count.startBody')}
        breadcrumbs={[
          { label: t('nav.inventory') },
          { label: t('count.listTitle'), to: COUNTS_PATH },
          { label: t('count.new') },
        ]}
      />
      <Form
        form={form}
        onSubmit={(v) => start.mutate({ v, company: useCompanyStore.getState().activeCompanyId })}
        className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <FormErrorSummary
            error={start.error}
            mapField={(field) => (field.startsWith('item_ids') ? null : snakeToCamelPath(field))}
            fieldLabels={{
              documentDate: t('fields.documentDate'),
              warehouseId: t('fields.warehouse'),
              itemIds: t('count.scopeItems'),
            }}
          />
        </div>
        <FormField<StartValues, 'documentDate'>
          name="documentDate"
          label={t('fields.documentDate')}
          required
          render={({ field, control }) => (
            <DateInput
              {...control}
              ref={field.ref}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
        <FormField<StartValues, 'warehouseId'>
          name="warehouseId"
          label={t('fields.warehouse')}
          required
          render={({ field, control }) => (
            <WarehouseSelect
              {...control}
              ref={field.ref}
              value={field.value}
              onBlur={field.onBlur}
              onChange={field.onChange}
            />
          )}
        />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <Checkbox checked={freeze} onChange={(e) => form.setValue('freeze', e.target.checked)} />
          {t('count.freeze')}
        </label>
        {freeze && (
          <div className="space-y-2 sm:col-span-2">
            <FieldShell label={t('count.scopeItems')} description={t('count.scopeItemsHint')}>
              {(control) => (
                <ItemCombobox
                  {...control}
                  value={null}
                  type="stock"
                  onChange={(id, item) => addItem(id, item)}
                />
              )}
            </FieldShell>
            {items.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label={t('count.scopeItems')}>
                {items.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center gap-1 rounded-md border border-border bg-surface-sunken py-0.5 pr-1 pl-2 text-xs"
                  >
                    {i.label}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1"
                      aria-label={t('count.removeItem', { item: i.label })}
                      onClick={() => setItems((prev) => prev.filter((x) => x.id !== i.id))}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="sm:col-span-2">
          <FormField<StartValues, 'notes'>
            name="notes"
            label={t('fields.notes')}
            render={({ field, control }) => <Input {...control} {...field} maxLength={2000} />}
          />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={() => void navigate(COUNTS_PATH)}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" disabled={start.isPending}>
            {start.isPending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Snowflake aria-hidden="true" />
            )}
            {freeze ? t('count.start') : t('count.startEmpty')}
          </Button>
        </div>
      </Form>
    </div>
  )
}
