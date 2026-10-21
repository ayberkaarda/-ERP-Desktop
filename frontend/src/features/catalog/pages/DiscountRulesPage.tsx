import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { createColumnHelper } from '@tanstack/react-table'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { DataTable, useUrlListQuery } from '@/components/shared/data-table'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { FormField } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { platform } from '@/platform'
import { discountRulesApi } from '../api/client'
import { catalogKeys } from '../api/keys'
import {
  CheckboxField,
  DateField,
  DecimalField,
  SelectField,
  TextField,
} from '../components/fields'
import { ItemCombobox } from '../components/ItemCombobox'
import { CategorySelect, PartyPicker } from '../components/pickers'
import { RecordDialog } from '../components/RecordDialog'
import { useDiscountRuleList, useIdempotencyKey, useInvalidate } from '../hooks/queries'
import { errorMessage, isVersionConflict } from '../lib/errors'
import {
  discountRuleDefaults,
  discountRuleSchema,
  toDiscountRuleInput,
  type DiscountRuleValues,
} from '../schemas'
import { DISCOUNT_SCOPES, type DiscountRule } from '../types'

const VIEW_KEY = 'catalog.discountRules'

export function DiscountRulesPage() {
  const { t } = useTranslation('catalog')
  const locale = useIntlLocale()
  const invalidate = useInvalidate()
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'priority', desc: true }] },
    { viewKey: VIEW_KEY },
  )
  const list = useDiscountRuleList(query)
  const [editing, setEditing] = useState<DiscountRule | 'new' | null>(null)
  const [deleting, setDeleting] = useState<DiscountRule | null>(null)

  const remove = useMutation({
    mutationFn: (r: DiscountRule) => discountRulesApi.remove(r.id),
    onSuccess: async () => {
      platform.notify.success(t('toast.deleted'))
      await invalidate(catalogKeys.discountRules())
    },
    onError: (e) => platform.notify.error(errorMessage(e, t('errors.deleteFailed'))),
  })

  const columns = useMemo(() => {
    const col = createColumnHelper<DiscountRule>()
    const date = (v: string | null) => (v ? formatDate(v, locale) : '—')
    return [
      col.accessor('code', {
        header: t('fields.code'),
        enableSorting: true,
        meta: { label: t('fields.code') },
        cell: (c) => <span className="font-code">{c.getValue()}</span>,
        size: 120,
      }),
      col.accessor('name', {
        header: t('fields.name'),
        enableSorting: true,
        meta: { label: t('fields.name') },
        size: 240,
      }),
      col.accessor('scope', {
        header: t('fields.scope'),
        meta: {
          label: t('fields.scope'),
          filter: { options: DISCOUNT_SCOPES.map((s) => ({ value: s, label: t(`scope.${s}`) })) },
        },
        cell: (c) => t(`scope.${c.getValue()}`),
        size: 120,
      }),
      col.accessor('discount_percent', {
        header: t('fields.discountPercent'),
        enableSorting: true,
        meta: { label: t('fields.discountPercent'), align: 'right' },
        cell: (c) =>
          `%${formatDecimalDisplay(c.getValue(), { locale, minFraction: 0, maxFraction: 4 })}`,
        size: 110,
      }),
      col.accessor('min_qty', {
        header: t('fields.minQty'),
        meta: { label: t('fields.minQty'), align: 'right' },
        cell: (c) => {
          const v = c.getValue()
          return v ? formatDecimalDisplay(v, { locale, minFraction: 0, maxFraction: 6 }) : '—'
        },
        size: 100,
      }),
      col.accessor('priority', {
        header: t('fields.priority'),
        enableSorting: true,
        meta: { label: t('fields.priority'), align: 'right' },
        size: 90,
      }),
      col.accessor('stackable', {
        header: t('fields.stackable'),
        meta: { label: t('fields.stackable') },
        cell: (c) => (c.getValue() ? t('common.yes') : t('common.no')),
        size: 100,
      }),
      col.display({
        id: 'validity',
        header: t('discounts.validity'),
        meta: { label: t('discounts.validity') },
        cell: (c) => `${date(c.row.original.valid_from)} – ${date(c.row.original.valid_to)}`,
        size: 200,
      }),
      col.accessor('is_active', {
        header: t('fields.status'),
        meta: {
          label: t('fields.status'),
          filter: {
            options: [
              { value: 'true', label: t('common.active') },
              { value: 'false', label: t('common.inactive') },
            ],
          },
        },
        cell: (c) => <StatusBadge status={c.getValue() ? 'active' : 'inactive'} />,
        size: 100,
      }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">{t('common.actions')}</span>,
        enableHiding: false,
        size: 90,
        cell: (c) => (
          <span className="flex justify-end gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('discounts.edit', { code: c.row.original.code })}
              onClick={() => setEditing(c.row.original)}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('discounts.remove', { code: c.row.original.code })}
              onClick={() => setDeleting(c.row.original)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </span>
        ),
      }),
    ]
  }, [t, locale])

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('discounts.title')}
        description={t('discounts.description')}
        breadcrumbs={[{ label: t('nav.catalog') }, { label: t('discounts.title') }]}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            {t('discounts.new')}
          </Button>
        }
      />
      <DataTable<DiscountRule>
        label={t('discounts.title')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta.total ?? 0}
        loading={list.isPending}
        error={list.isError}
        onRetry={() => void list.refetch()}
        query={query}
        onQueryChange={setQuery}
        getRowId={(r) => r.id}
        viewKey={VIEW_KEY}
        onRowActivate={(r) => setEditing(r)}
      />
      {editing !== null && (
        <DiscountRuleDialog
          key={editing === 'new' ? 'new' : editing.id}
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('discounts.removeTitle')}
        description={deleting ? t('discounts.removeBody', { code: deleting.code }) : undefined}
        confirmLabel={t('actions.delete')}
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting)
        }}
      />
    </div>
  )
}

function DiscountRuleDialog({ rule, onClose }: { rule: DiscountRule | null; onClose: () => void }) {
  const { t } = useTranslation('catalog')
  const invalidate = useInvalidate()
  const idem = useIdempotencyKey()
  const [base, setBase] = useState(rule)
  const form = useForm<DiscountRuleValues>({
    resolver: zodResolver(discountRuleSchema),
    defaultValues: discountRuleDefaults(rule ?? undefined),
  })
  const scope = useWatch({ control: form.control, name: 'scope' })

  const save = useMutation({
    mutationFn: (v: DiscountRuleValues) => {
      const input = toDiscountRuleInput(v)
      return base
        ? discountRulesApi.update(base.id, { ...input, version: base.version })
        : discountRulesApi.create(input, idem.current(input))
    },
    onSuccess: async () => {
      idem.reset()
      platform.notify.success(t('toast.saved'))
      await invalidate(catalogKeys.discountRules())
      onClose()
    },
  })
  const reload = async () => {
    if (!base) return
    const fresh = await discountRulesApi.get(base.id)
    save.reset()
    setBase(fresh)
    form.reset(discountRuleDefaults(fresh))
    await invalidate(catalogKeys.discountRules())
  }

  const labels: Record<string, string> = {
    code: t('fields.code'),
    name: t('fields.name'),
    scope: t('fields.scope'),
    scope_ref: t(`discounts.scopeRef.${scope}`),
    party_id: t('fields.party'),
    min_qty: t('fields.minQty'),
    discount_percent: t('fields.discountPercent'),
    priority: t('fields.priority'),
    valid_from: t('fields.validFrom'),
    valid_to: t('fields.validTo'),
  }

  return (
    <RecordDialog<DiscountRuleValues>
      open
      onOpenChange={(o) => !o && onClose()}
      title={base ? t('discounts.editTitle') : t('discounts.newTitle')}
      form={form}
      onSubmit={(v) => save.mutate(v)}
      error={save.error}
      busy={save.isPending}
      onReload={isVersionConflict(save.error) ? () => void reload() : undefined}
      fieldLabels={labels}
      className="max-w-2xl"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField<DiscountRuleValues, 'code'>
          name="code"
          label={labels.code ?? ''}
          required
          input={{ autoComplete: 'off', className: 'font-code', maxLength: 32 }}
        />
        <TextField<DiscountRuleValues, 'name'> name="name" label={labels.name ?? ''} required />
        <SelectField<DiscountRuleValues, 'scope'>
          name="scope"
          label={labels.scope ?? ''}
          required
          options={DISCOUNT_SCOPES.map((s) => ({ value: s, label: t(`scope.${s}`) }))}
          // A new scope invalidates the referenced row (an item id is not a category id).
          onValueChange={() => form.setValue('scope_ref', '')}
        />
        {scope !== 'all' ? (
          <FormField<DiscountRuleValues, 'scope_ref'>
            key={scope}
            name="scope_ref"
            label={labels.scope_ref ?? ''}
            required
            render={({ field, control }) => {
              const common = {
                ...control,
                ref: field.ref,
                value: field.value || null,
                onBlur: field.onBlur,
              }
              if (scope === 'item')
                return <ItemCombobox {...common} onChange={(v) => field.onChange(v ?? '')} />
              if (scope === 'category')
                return <CategorySelect {...common} onChange={(v) => field.onChange(v ?? '')} />
              return <PartyPicker {...common} onChange={(v) => field.onChange(v ?? '')} />
            }}
          />
        ) : (
          <p className="self-end pb-2 text-xs text-muted-foreground">{t('discounts.allHelp')}</p>
        )}
        {scope !== 'party' && (
          <FormField<DiscountRuleValues, 'party_id'>
            name="party_id"
            label={labels.party_id ?? ''}
            description={t('discounts.partyHelp')}
            className="sm:col-span-2"
            render={({ field, control }) => (
              <PartyPicker
                {...control}
                ref={field.ref}
                value={field.value || null}
                onChange={(v) => field.onChange(v ?? '')}
                onBlur={field.onBlur}
              />
            )}
          />
        )}
        <DecimalField<DiscountRuleValues, 'discount_percent'>
          name="discount_percent"
          label={labels.discount_percent ?? ''}
          required
          scale={4}
          suffix="%"
        />
        <DecimalField<DiscountRuleValues, 'min_qty'>
          name="min_qty"
          label={labels.min_qty ?? ''}
          scale={6}
          description={t('discounts.minQtyHelp')}
        />
        <TextField<DiscountRuleValues, 'priority'>
          name="priority"
          label={labels.priority ?? ''}
          required
          description={t('discounts.priorityHelp')}
          input={{ inputMode: 'numeric', maxLength: 6 }}
        />
        <div />
        <DateField<DiscountRuleValues, 'valid_from'>
          name="valid_from"
          label={labels.valid_from ?? ''}
        />
        <DateField<DiscountRuleValues, 'valid_to'> name="valid_to" label={labels.valid_to ?? ''} />
        <CheckboxField<DiscountRuleValues, 'stackable'>
          name="stackable"
          label={t('fields.stackable')}
          description={t('discounts.stackableHelp')}
        />
        <CheckboxField<DiscountRuleValues, 'is_active'>
          name="is_active"
          label={t('fields.isActive')}
        />
      </div>
    </RecordDialog>
  )
}
