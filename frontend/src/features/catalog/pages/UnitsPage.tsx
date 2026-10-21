import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { createColumnHelper } from '@tanstack/react-table'
import { Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { DataTable, useUrlListQuery } from '@/components/shared/data-table'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { platform } from '@/platform'
import { unitsApi } from '../api/client'
import { catalogKeys } from '../api/keys'
import { ConversionMatrix } from '../components/ConversionMatrix'
import { CheckboxField, TextField } from '../components/fields'
import { RecordDialog } from '../components/RecordDialog'
import { useIdempotencyKey, useInvalidate, useUnitList } from '../hooks/queries'
import { isVersionConflict } from '../lib/errors'
import { unitSchema, type UnitValues } from '../schemas'
import type { Unit } from '../types'

const VIEW_KEY = 'catalog.units'

export function UnitsPage() {
  const { t } = useTranslation('catalog')
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'conversions' ? 'conversions' : 'units'
  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader
        title={t('units.title')}
        description={t('units.description')}
        breadcrumbs={[{ label: t('nav.catalog') }, { label: t('units.title') }]}
      />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev)
              if (v === 'units') next.delete('tab')
              else next.set('tab', v)
              return next
            },
            { replace: true },
          )
        }
      >
        <TabsList>
          <TabsTrigger value="units">{t('units.tabUnits')}</TabsTrigger>
          <TabsTrigger value="conversions">{t('units.tabConversions')}</TabsTrigger>
        </TabsList>
        <TabsContent value="units">
          <UnitsTable />
        </TabsContent>
        <TabsContent value="conversions">
          <ConversionMatrix />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function UnitsTable() {
  const { t } = useTranslation('catalog')
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'code', desc: false }] },
    { viewKey: VIEW_KEY },
  )
  const list = useUnitList(query)
  const [editing, setEditing] = useState<Unit | 'new' | null>(null)

  const columns = useMemo(() => {
    const col = createColumnHelper<Unit>()
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
      col.accessor('symbol', {
        header: t('fields.symbol'),
        meta: { label: t('fields.symbol') },
        cell: (c) => c.getValue() ?? '—',
        size: 100,
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
        size: 120,
      }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">{t('common.actions')}</span>,
        enableHiding: false,
        size: 60,
        cell: (c) => (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('units.edit', { code: c.row.original.code })}
            onClick={() => setEditing(c.row.original)}
          >
            <Pencil aria-hidden="true" />
          </Button>
        ),
      }),
    ]
  }, [t])

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" />
          {t('units.new')}
        </Button>
      </div>
      <DataTable<Unit>
        label={t('units.tabUnits')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta.pagination.total ?? 0}
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
        <UnitDialog
          unit={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onReloaded={(u) => setEditing(u)}
        />
      )}
    </div>
  )
}

function UnitDialog({
  unit,
  onClose,
  onReloaded,
}: {
  unit: Unit | null
  onClose: () => void
  onReloaded: (u: Unit) => void
}) {
  const { t } = useTranslation('catalog')
  const invalidate = useInvalidate()
  const idem = useIdempotencyKey()
  const form = useForm<UnitValues>({
    resolver: zodResolver(unitSchema),
    defaultValues: {
      code: unit?.code ?? '',
      name: unit?.name ?? '',
      symbol: unit?.symbol ?? '',
      is_active: unit?.is_active ?? true,
    },
  })
  const save = useMutation({
    mutationFn: (v: UnitValues) => {
      const input = { ...v, code: v.code.trim(), symbol: v.symbol.trim() || null }
      return unit
        ? unitsApi.update(unit.id, { ...input, version: unit.version })
        : unitsApi.create(input, idem.current(input))
    },
    onSuccess: async () => {
      idem.reset()
      platform.notify.success(t('toast.saved'))
      await invalidate(catalogKeys.units())
      onClose()
    },
  })
  const reload = async () => {
    if (!unit) return
    const fresh = await unitsApi.get(unit.id)
    await invalidate(catalogKeys.units())
    save.reset()
    onReloaded(fresh)
    form.reset({
      code: fresh.code,
      name: fresh.name,
      symbol: fresh.symbol ?? '',
      is_active: fresh.is_active,
    })
  }
  const labels = {
    code: t('fields.code'),
    name: t('fields.name'),
    symbol: t('fields.symbol'),
  }
  return (
    <RecordDialog<UnitValues>
      open
      onOpenChange={(o) => !o && onClose()}
      title={unit ? t('units.editTitle') : t('units.newTitle')}
      form={form}
      onSubmit={(v) => save.mutate(v)}
      error={save.error}
      busy={save.isPending}
      onReload={isVersionConflict(save.error) ? () => void reload() : undefined}
      fieldLabels={labels}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField<UnitValues, 'code'>
          name="code"
          label={labels.code}
          required
          input={{ autoComplete: 'off', className: 'font-code uppercase', maxLength: 32 }}
        />
        <TextField<UnitValues, 'symbol'> name="symbol" label={labels.symbol} />
        <TextField<UnitValues, 'name'>
          name="name"
          label={labels.name}
          required
          className="sm:col-span-2"
        />
        <CheckboxField<UnitValues, 'is_active'> name="is_active" label={t('fields.isActive')} />
      </div>
    </RecordDialog>
  )
}
