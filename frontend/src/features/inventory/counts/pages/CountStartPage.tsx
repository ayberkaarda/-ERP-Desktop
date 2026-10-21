import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Snowflake } from 'lucide-react'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { DateInput, Form, FormErrorSummary, FormField } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { toIsoDate } from '@/lib/datetime'
import { calendarDate, snakeToCamelPath } from '@/lib/forms'
import { useCompanyStore } from '@/stores/company'
import { documentsApi } from '../../documents/api/client'
import { invDocsKeys } from '../../documents/api/keys'
import { CategorySelect, LocationSelect, WarehouseSelect } from '../../documents/components/pickers'
import { useWarehouses } from '../../documents/hooks/queries'
import { usePayloadKeys } from '../../documents/lib/idempotency'
import type { CountStartInput } from '../../documents/types'
import { COUNTS_PATH } from '../components/CountEditor'

interface StartValues {
  documentDate: string
  warehouseId: string
  locationId: string
  categoryId: string
  includeZero: boolean
  notes: string
}

/** Starts a count: the scope's system quantities are frozen as the count's lines. */
export function CountStartPage() {
  const { t } = useTranslation('inventoryDocs')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const warehouses = useWarehouses()
  const schema = z.object({
    documentDate: calendarDate(),
    warehouseId: z.string().min(1, t('validation.warehouse')),
    locationId: z.string(),
    categoryId: z.string(),
    includeZero: z.boolean(),
    notes: z.string().max(2000, t('validation.tooLong')),
  })
  const form = useForm<StartValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      documentDate: toIsoDate(new Date()),
      warehouseId: '',
      locationId: '',
      categoryId: '',
      includeZero: false,
      notes: '',
    },
  })
  const warehouseId = useWatch({ control: form.control, name: 'warehouseId' })
  const includeZero = useWatch({ control: form.control, name: 'includeZero' })
  const defaultWarehouse = warehouses.data?.find((w) => w.is_default && w.is_active)?.id ?? ''
  useEffect(() => {
    if (defaultWarehouse && form.getValues('warehouseId') === '')
      form.setValue('warehouseId', defaultWarehouse)
  }, [defaultWarehouse, form])

  const start = useMutation({
    mutationFn: ({ v }: { v: StartValues; company: string | null }) => {
      const input: CountStartInput = {
        doc_type: 'count',
        document_date: v.documentDate,
        warehouse_id: v.warehouseId,
        freeze: true,
        location_id: v.locationId || null,
        category_id: v.categoryId || null,
        include_zero: v.includeZero,
        notes: v.notes.trim() || null,
      }
      return documentsApi.startCount(input, keyFor(input))
    },
    onSuccess: (doc, { company }) => {
      queryClient.setQueryData(invDocsKeys.document(doc.id, company ?? 'none'), doc)
      void queryClient.invalidateQueries({ queryKey: invDocsKeys.documents(company ?? 'none') })
      if (useCompanyStore.getState().activeCompanyId === company)
        void navigate(`${COUNTS_PATH}/${doc.id}`, { replace: true })
    },
  })

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
            mapField={snakeToCamelPath}
            fieldLabels={{
              documentDate: t('fields.documentDate'),
              warehouseId: t('fields.warehouse'),
              locationId: t('count.scopeLocation'),
              categoryId: t('count.scopeCategory'),
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
              onChange={(v) => {
                field.onChange(v)
                form.setValue('locationId', '')
              }}
            />
          )}
        />
        <FormField<StartValues, 'locationId'>
          name="locationId"
          label={t('count.scopeLocation')}
          render={({ field, control }) => (
            <LocationSelect
              {...control}
              ref={field.ref}
              warehouseId={warehouseId}
              value={field.value}
              onBlur={field.onBlur}
              onChange={field.onChange}
            />
          )}
        />
        <FormField<StartValues, 'categoryId'>
          name="categoryId"
          label={t('count.scopeCategory')}
          render={({ field, control }) => (
            <CategorySelect
              {...control}
              ref={field.ref}
              value={field.value}
              onBlur={field.onBlur}
              onChange={field.onChange}
            />
          )}
        />
        <div className="sm:col-span-2">
          <FormField<StartValues, 'notes'>
            name="notes"
            label={t('fields.notes')}
            render={({ field, control }) => <Input {...control} {...field} maxLength={2000} />}
          />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <Checkbox
            checked={includeZero}
            onChange={(e) => form.setValue('includeZero', e.target.checked)}
          />
          {t('count.includeZero')}
        </label>
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
            {t('count.start')}
          </Button>
        </div>
      </Form>
    </div>
  )
}
