import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { Form, FormErrorSummary, FormField } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { usePermission } from '@/lib/permissions'
import { isApiError, platform } from '@/platform'
import { priceListsApi } from '../api/client'
import { catalogKeys } from '../api/keys'
import { CheckboxField, DateField, TextField } from '../components/fields'
import { CurrencySelect } from '../components/pickers'
import { PriceLinesEditor } from '../components/PriceLinesEditor'
import { VersionConflictAlert } from '../components/VersionConflictAlert'
import { useIdempotencyKey, useInvalidate, usePriceList } from '../hooks/queries'
import { errorMessage, isVersionConflict } from '../lib/errors'
import {
  priceListDefaults,
  priceListSchema,
  toPriceListInput,
  type PriceListValues,
} from '../schemas'
import type { PriceList } from '../types'

export function PriceListFormPage() {
  const { id } = useParams()
  const { t } = useTranslation('catalog')
  const priceList = usePriceList(id)
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
      <PageHeader
        title={id ? (priceList.data?.name ?? t('priceLists.editTitle')) : t('priceLists.newTitle')}
        breadcrumbs={[
          { label: t('nav.catalog') },
          { label: t('priceLists.title'), to: '/catalog/price-lists' },
          { label: id ? (priceList.data?.code ?? '…') : t('priceLists.newTitle') },
        ]}
        meta={
          priceList.data ? (
            <StatusBadge status={priceList.data.is_active ? 'active' : 'inactive'} />
          ) : undefined
        }
      />
      {id && priceList.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : id && priceList.isError ? (
        <EmptyState
          title={
            isApiError(priceList.error) && priceList.error.status === 404
              ? t('priceLists.notFound')
              : t('errors.loadFailed')
          }
          action={
            <Button variant="secondary" onClick={() => void priceList.refetch()}>
              {t('actions.retry')}
            </Button>
          }
        />
      ) : (
        <>
          <HeaderForm key={priceList.data?.id ?? 'new'} priceList={priceList.data} />
          {priceList.data ? (
            <PriceLinesEditor priceList={priceList.data} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('priceLists.saveFirst')}</p>
          )}
        </>
      )}
    </div>
  )
}

function HeaderForm({ priceList }: { priceList: PriceList | undefined }) {
  const { t } = useTranslation('catalog')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const invalidate = useInvalidate()
  const idem = useIdempotencyKey()
  const canEdit = usePermission(priceList ? 'price_lists.update' : 'price_lists.create')
  const canDelete = usePermission('price_lists.delete')
  const [base, setBase] = useState(priceList)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const form = useForm<PriceListValues>({
    resolver: zodResolver(priceListSchema),
    defaultValues: priceListDefaults(priceList),
  })

  const save = useMutation({
    mutationFn: (v: PriceListValues) => {
      const input = toPriceListInput(v)
      return base
        ? priceListsApi.update(base.id, { ...input, version: base.version })
        : priceListsApi.create(input, idem.current(input))
    },
    onSuccess: async (saved) => {
      idem.reset()
      queryClient.setQueryData(catalogKeys.priceList(saved.id), saved)
      await invalidate(catalogKeys.priceLists())
      platform.notify.success(t('toast.saved'))
      if (!base) void navigate(`/catalog/price-lists/${saved.id}`, { replace: true })
      else {
        setBase(saved)
        form.reset(priceListDefaults(saved))
      }
    },
  })
  const remove = useMutation({
    mutationFn: () => priceListsApi.remove(base?.id ?? ''),
    onSuccess: async () => {
      platform.notify.success(t('toast.deleted'))
      await invalidate(catalogKeys.priceLists())
      void navigate('/catalog/price-lists')
    },
    onError: (e) => platform.notify.error(errorMessage(e, t('errors.deleteFailed'))),
  })
  const reload = async () => {
    if (!base) return
    const fresh = await priceListsApi.get(base.id)
    queryClient.setQueryData(catalogKeys.priceList(fresh.id), fresh)
    save.reset()
    setBase(fresh)
    form.reset(priceListDefaults(fresh))
  }

  const labels = {
    code: t('fields.code'),
    name: t('fields.name'),
    currency_code: t('fields.currency'),
    valid_from: t('fields.validFrom'),
    valid_to: t('fields.validTo'),
  }

  return (
    <section
      aria-labelledby="pl-header"
      className="space-y-4 rounded-lg border border-border bg-surface p-5"
    >
      <h2 id="pl-header" className="text-base font-semibold">
        {t('priceLists.header')}
      </h2>
      <Form form={form} onSubmit={(v) => save.mutate(v)} className="space-y-4">
        {isVersionConflict(save.error) ? (
          <VersionConflictAlert onReload={() => void reload()} />
        ) : (
          <FormErrorSummary error={save.error} fieldLabels={labels} />
        )}
        <fieldset disabled={!canEdit || save.isPending} className="grid gap-4 sm:grid-cols-3">
          <legend className="sr-only">{t('priceLists.header')}</legend>
          <TextField<PriceListValues, 'code'>
            name="code"
            label={labels.code}
            required
            input={{
              autoComplete: 'off',
              className: 'font-code',
              maxLength: 32,
              autoFocus: !priceList,
            }}
          />
          <TextField<PriceListValues, 'name'>
            name="name"
            label={labels.name}
            required
            className="sm:col-span-2"
          />
          <FormField<PriceListValues, 'currency_code'>
            name="currency_code"
            label={labels.currency_code}
            required
            render={({ field, control }) => (
              <CurrencySelect
                {...control}
                ref={field.ref}
                value={field.value || null}
                onChange={(v) => field.onChange(v ?? '')}
                onBlur={field.onBlur}
              />
            )}
          />
          <DateField<PriceListValues, 'valid_from'> name="valid_from" label={labels.valid_from} />
          <DateField<PriceListValues, 'valid_to'> name="valid_to" label={labels.valid_to} />
          <CheckboxField<PriceListValues, 'is_default'>
            name="is_default"
            label={t('priceLists.isDefault')}
            description={t('priceLists.isDefaultHelp')}
          />
          <CheckboxField<PriceListValues, 'tax_inclusive'>
            name="tax_inclusive"
            label={t('fields.taxInclusive')}
            description={t('priceLists.taxInclusiveHelp')}
          />
          <CheckboxField<PriceListValues, 'is_active'>
            name="is_active"
            label={t('fields.isActive')}
          />
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Button type="submit" disabled={save.isPending || isVersionConflict(save.error)}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {priceList ? t('priceLists.saveHeader') : t('actions.save')}
            </Button>
          )}
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
      </Form>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('priceLists.deleteTitle')}
        description={t('priceLists.deleteBody', { name: base?.name ?? '' })}
        confirmLabel={t('actions.delete')}
        onConfirm={async () => {
          await remove.mutateAsync()
        }}
      />
    </section>
  )
}
