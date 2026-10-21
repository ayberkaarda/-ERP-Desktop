import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, RotateCcw, Save } from 'lucide-react'
import { useMemo, type KeyboardEvent } from 'react'
import { useForm, useFormState } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import {
  DateInput,
  DecimalInput,
  Form,
  FormErrorSummary,
  QuantityInput,
} from '@/components/shared/form'
import {
  DocumentLinesEditor,
  type LineCellProps,
  type LineColumn,
} from '@/components/shared/lines/DocumentLinesEditor'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { usePermission } from '@/lib/permissions'
import { isApiError, platform } from '@/platform'
import { priceListsApi } from '../api/client'
import { catalogKeys } from '../api/keys'
import { usePriceListLines, useVariants } from '../hooks/queries'
import { isVersionConflict } from '../lib/errors'
import {
  emptyLine,
  priceLinesSchema,
  toLineInput,
  toLineValues,
  type PriceLinesValues,
  type PriceLineValues,
} from '../schemas'
import type { PriceList, PriceListLine } from '../types'
import { selectClass } from '../lib/ui'
import { ItemCombobox } from './ItemCombobox'
import { UnitSelect } from './pickers'
import { VersionConflictAlert } from './VersionConflictAlert'

/** Lines grid: keyboard entry via DocumentLinesEditor, saved in one PUT (replace all). */
export function PriceLinesEditor({ priceList }: { priceList: PriceList }) {
  const { t } = useTranslation('catalog')
  const lines = usePriceListLines(priceList.id)
  if (lines.isPending) return <Skeleton className="h-48 w-full" />
  if (lines.isError) {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-danger">
        {t('errors.loadFailed')}
        <Button size="sm" variant="secondary" onClick={() => void lines.refetch()}>
          {t('actions.retry')}
        </Button>
      </div>
    )
  }
  return <LinesForm key={lines.dataUpdatedAt} priceList={priceList} initial={lines.data} />
}

const LINE_FIELDS = [
  'item_id',
  'variant_id',
  'unit_id',
  'min_qty',
  'price',
  'valid_from',
  'valid_to',
] as const

function lineErrorRows(error: unknown): number[] {
  if (!isApiError(error)) return []
  const rows = new Set<number>()
  for (const key of Object.keys(error.fields)) {
    const m = /^lines\.(\d+)\./.exec(key)
    if (m) rows.add(Number(m[1]))
  }
  return [...rows].sort((a, b) => a - b)
}

function LinesForm({ priceList, initial }: { priceList: PriceList; initial: PriceListLine[] }) {
  const { t } = useTranslation('catalog')
  const queryClient = useQueryClient()
  const canEdit = usePermission('price_lists.update')
  const form = useForm<PriceLinesValues>({
    resolver: zodResolver(priceLinesSchema),
    defaultValues: { lines: initial.map(toLineValues) },
  })
  const { isDirty } = useFormState({ control: form.control })

  const save = useMutation({
    mutationFn: (v: PriceLinesValues) =>
      priceListsApi.saveLines(priceList.id, v.lines.map(toLineInput)),
    onSuccess: (saved) => {
      queryClient.setQueryData(catalogKeys.priceListLines(priceList.id), saved)
      form.reset({ lines: saved.map(toLineValues) })
      platform.notify.success(t('priceLines.saved', { count: saved.length }))
    },
  })
  const failedRows = lineErrorRows(save.error)

  const reload = async () => {
    save.reset()
    await queryClient.invalidateQueries({ queryKey: catalogKeys.priceListLines(priceList.id) })
  }

  const columns = useMemo<LineColumn<PriceLineValues>[]>(
    () => [
      {
        id: 'item_id',
        header: t('fields.item'),
        width: '26%',
        render: (c) => (
          <ItemCombobox
            {...c.cell}
            ref={c.ref}
            value={c.value || null}
            disabled={c.disabled}
            className="min-w-56"
            onBlur={c.onBlur}
            onChange={(id, item) => {
              c.setValue(id ?? '')
              form.setValue(`lines.${c.index}.variant_id`, '')
              // The base unit is the usual pricing unit; pre-fill it.
              if (item && !form.getValues(`lines.${c.index}.unit_id`))
                form.setValue(`lines.${c.index}.unit_id`, item.base_unit_id, { shouldDirty: true })
            }}
          />
        ),
      },
      {
        id: 'variant_id',
        header: t('fields.variant'),
        width: '12%',
        render: (c) => (
          <VariantCell
            itemId={c.line.item_id}
            cell={c.cell}
            value={c.value}
            onChange={c.setValue}
            onBlur={c.onBlur}
            disabled={c.disabled}
            selectRef={c.ref}
          />
        ),
      },
      {
        id: 'unit_id',
        header: t('fields.unit'),
        width: '12%',
        render: (c) => (
          <UnitSelect
            {...c.cell}
            ref={c.ref}
            value={c.value || null}
            onChange={(v) => c.setValue(v ?? '')}
            onBlur={c.onBlur}
            disabled={c.disabled}
            className="min-w-28"
          />
        ),
      },
      {
        id: 'min_qty',
        header: t('fields.minQty'),
        align: 'right',
        render: (c) => (
          <QuantityInput
            {...c.cell}
            ref={c.ref}
            scale={6}
            value={c.value}
            onChange={c.setValue}
            onBlur={c.onBlur}
            disabled={c.disabled}
            className="min-w-24"
          />
        ),
      },
      {
        id: 'price',
        header: t('fields.price'),
        align: 'right',
        render: (c) => (
          <DecimalInput
            {...c.cell}
            ref={c.ref}
            scale={6}
            displayMinFraction={2}
            suffix={priceList.currency_code}
            value={c.value}
            onChange={c.setValue}
            onBlur={c.onBlur}
            disabled={c.disabled}
            className="min-w-28"
          />
        ),
      },
      {
        id: 'valid_from',
        header: t('fields.validFrom'),
        render: (c) => (
          <DateInput
            {...c.cell}
            ref={c.ref}
            value={c.value}
            onChange={c.setValue}
            onBlur={c.onBlur}
            disabled={c.disabled}
          />
        ),
      },
      {
        id: 'valid_to',
        header: t('fields.validTo'),
        render: (c) => (
          <DateInput
            {...c.cell}
            ref={c.ref}
            value={c.value}
            onChange={c.setValue}
            onBlur={c.onBlur}
            disabled={c.disabled}
          />
        ),
      },
    ],
    [t, form, priceList.currency_code],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    // Ctrl/Cmd+S saves the whole grid, as in desktop price editors.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (canEdit && !save.isPending) void form.handleSubmit((v) => save.mutate(v))()
    }
  }

  return (
    <section aria-labelledby="pl-lines" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="pl-lines" className="text-base font-semibold">
            {t('priceLines.title')}
          </h2>
          <p className="text-xs text-muted-foreground">{t('priceLines.hint')}</p>
        </div>
      </div>
      <Form
        form={form}
        onSubmit={(v) => save.mutate(v)}
        onKeyDown={onKeyDown}
        className="space-y-3"
      >
        {isVersionConflict(save.error) ? (
          <VersionConflictAlert onReload={() => void reload()} />
        ) : (
          <FormErrorSummary
            error={save.error}
            fieldLabels={Object.fromEntries(
              failedRows.flatMap((r) =>
                LINE_FIELDS.map((f) => [
                  `lines.${r}.${f}`,
                  t('priceLines.cellLabel', { row: r + 1, field: t(`priceLines.field.${f}`) }),
                ]),
              ),
            )}
          />
        )}
        <DocumentLinesEditor<PriceLinesValues, PriceLineValues>
          name="lines"
          label={t('priceLines.title')}
          columns={columns}
          newLine={emptyLine}
          disabled={!canEdit || save.isPending}
          footer={(rows) => (
            <p className="text-right text-xs text-muted-foreground">
              {t('priceLines.count', { count: rows.length })}
              {failedRows.length > 0 && (
                <span className="ml-3 text-danger">
                  {t('priceLines.failedRows', { rows: failedRows.map((r) => r + 1).join(', ') })}
                </span>
              )}
            </p>
          )}
        />
        {canEdit && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isDirty && (
              <span role="status" className="mr-auto text-xs text-warning-soft-foreground">
                {t('priceLines.unsaved')}
              </span>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={!isDirty || save.isPending}
              onClick={() => {
                save.reset()
                form.reset()
              }}
            >
              <RotateCcw aria-hidden="true" />
              {t('actions.discard')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Save aria-hidden="true" />
              )}
              {t('priceLines.save')}
            </Button>
          </div>
        )}
      </Form>
    </section>
  )
}

function VariantCell({
  itemId,
  cell,
  value,
  onChange,
  onBlur,
  disabled,
  selectRef,
}: {
  itemId: string
  cell: LineCellProps
  value: string
  onChange: (v: string) => void
  onBlur: () => void
  disabled: boolean
  selectRef: (el: HTMLElement | null) => void
}) {
  const { t } = useTranslation('catalog')
  const variants = useVariants(itemId || undefined)
  const options = variants.data ?? []
  return (
    <select
      {...cell}
      ref={selectRef}
      className={selectClass}
      value={value}
      disabled={disabled || options.length === 0}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    >
      <option value="">{t('priceLines.anyVariant')}</option>
      {options.map((v) => (
        <option key={v.id} value={v.id}>
          {v.sku}
        </option>
      ))}
    </select>
  )
}
