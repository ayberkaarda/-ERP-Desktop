import { ListChecks } from 'lucide-react'
import { useState, type KeyboardEvent, type MouseEvent, type RefCallback } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Combobox, DateInput, DecimalInput } from '@/components/shared/form'
import {
  DocumentLinesEditor,
  type LineCellProps,
  type LineColumn,
} from '@/components/shared/lines/DocumentLinesEditor'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { platform } from '@/platform'
import { ItemCombobox } from '@/features/catalog'
import { useQueryClient } from '@tanstack/react-query'
import { lookupsApi } from '../api/client'
import { invDocsKeys } from '../api/keys'
import { useItemUnits, useLocations } from '../hooks/queries'
import {
  docTotals,
  emptyLine,
  parseSerials,
  toItemRef,
  typeRules,
  withBaseUnit,
  type DocValues,
  type LineValues,
} from '../lib/lines'
import { baseQuantity, lineCost, trimDecimal } from '../lib/quantity'
import { MAX_LINES, type ItemRef } from '../types'
import { LocationSelect } from './pickers'

interface StockLinesGridProps {
  disabled?: boolean
}

/** A cell with nothing to edit for this line that stays in the Enter/arrow flow. */
function NotApplicable({ cell }: { cell: LineCellProps }) {
  const { t } = useTranslation('inventoryDocs')
  return (
    <Input
      {...cell}
      readOnly
      value=""
      placeholder={t('lines.notTracked')}
      className="h-control-sm bg-surface-sunken text-center"
    />
  )
}

/** The units of the line's item; picking one carries its code and factor into the line. */
function UnitCell({
  cell,
  inputRef,
  value,
  item,
  unitCode,
  disabled,
  onBlur,
  onPick,
}: {
  cell: LineCellProps
  inputRef: RefCallback<HTMLElement>
  value: string
  item: ItemRef | null
  unitCode: string
  disabled: boolean
  onBlur: () => void
  onPick: (unit: { id: string; code: string; factor: string }) => void
}) {
  const units = useItemUnits(item)
  const options = (units.data ?? []).map((u) => ({
    value: u.unit_id,
    label: u.code || u.name,
    description: u.factor === '1' ? undefined : `× ${trimDecimal(u.factor)}`,
  }))
  const selected = value ? { value, label: unitCode || value } : null
  return (
    <Combobox
      {...cell}
      ref={inputRef}
      value={value || null}
      selectedOption={selected}
      options={options}
      loading={units.isLoading}
      disabled={disabled || !item}
      className="min-w-24"
      onBlur={onBlur}
      onChange={(id) => {
        const unit = units.data?.find((u) => u.unit_id === id)
        if (unit) onPick({ id: unit.unit_id, code: unit.code, factor: unit.factor })
      }}
    />
  )
}

/** Opens a dialog to type or scan serial numbers, one per line. */
function SerialsCell({
  cell,
  buttonRef,
  value,
  index,
  disabled,
  required,
  onSave,
}: {
  cell: LineCellProps
  buttonRef: RefCallback<HTMLElement>
  value: string
  index: number
  disabled: boolean
  required: string | null
  onSave: (serials: string) => void
}) {
  const { t } = useTranslation('inventoryDocs')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const count = parseSerials(value).length
  return (
    <>
      <Button
        {...cell}
        ref={buttonRef}
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        title={t('lines.editSerials', { index: index + 1 })}
        className="h-control-sm w-full justify-start"
        onClick={() => {
          setDraft(value)
          setOpen(true)
        }}
      >
        <ListChecks aria-hidden="true" />
        {t('lines.serialCount', { count })}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t('actions.close')}>
          <DialogHeader>
            <DialogTitle>{t('lines.serialsTitle')}</DialogTitle>
            <DialogDescription>
              {t('lines.serialsBody', { count: Number(required ?? 0) })}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label={t('lines.serials')}
            value={draft}
            rows={8}
            autoFocus
            className="font-code"
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="text-xs text-muted-foreground" role="status">
            {t('lines.serialsEntered', { count: parseSerials(draft).length })}
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                onSave(parseSerials(draft).join('\n'))
                setOpen(false)
              }}
            >
              {t('actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Stock lines on the shared DocumentLinesEditor: item picker, unit with conversion preview,
 * lot / expiry / serial columns shown for tracked items, locations when the warehouse has them,
 * unit cost for inbound documents, and live totals in the footer.
 */
export function StockLinesGrid({ disabled = false }: StockLinesGridProps) {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const { control, setValue, getValues } = useFormContext<DocValues>()
  const queryClient = useQueryClient()
  const lines = useWatch({ control, name: 'lines' })
  const docType = useWatch({ control, name: 'docType' })
  const warehouseId = useWatch({ control, name: 'warehouseId' })
  const targetWarehouseId = useWatch({ control, name: 'targetWarehouseId' })
  const rules = typeRules(docType)
  const sourceLocations = useLocations(warehouseId)
  const targetLocations = useLocations(rules.target ? targetWarehouseId : '')
  const qty = (v: string) =>
    formatDecimalDisplay(trimDecimal(v), { locale, minFraction: 0, maxFraction: 6 })

  const set = (index: number, patch: Partial<LineValues>) => {
    for (const [key, value] of Object.entries(patch)) {
      setValue(`lines.${index}.${key as keyof LineValues}`, value as never, {
        shouldDirty: true,
        shouldValidate: false,
      })
    }
  }

  /** Search rows may not embed the base unit: label it from the item's units once loaded. */
  const labelBaseUnit = (index: number, item: ItemRef) => {
    void queryClient
      .query({
        queryKey: invDocsKeys.itemUnits(item.id),
        queryFn: ({ signal }) => lookupsApi.itemUnits(item, signal),
        staleTime: 5 * 60_000,
      })
      .then((units) => {
        if (getValues(`lines.${index}.itemId`) !== item.id) return
        const labelled = withBaseUnit(item, units)
        set(index, {
          item: labelled,
          ...(getValues(`lines.${index}.unitId`) === item.base_unit_id
            ? { unitCode: labelled.base_unit?.code ?? '' }
            : {}),
        })
      })
      .catch(() => undefined)
  }

  const anyItem = (pick: (i: ItemRef) => boolean) =>
    lines.some((l) => (l.item ? pick(l.item) : false))
  const showLot = anyItem((i) => i.tracking === 'lot')
  const showExpiry = anyItem((i) => i.has_expiry)
  const showSerials = anyItem((i) => i.tracking === 'serial')
  const showLocation = (sourceLocations.data?.length ?? 0) > 0
  const showTarget = rules.target && (targetLocations.data?.length ?? 0) > 0

  const columns: LineColumn<LineValues>[] = [
    {
      id: 'itemId',
      header: t('lines.item'),
      width: '18rem',
      render: (ctx) => (
        <ItemCombobox
          {...ctx.cell}
          ref={ctx.ref}
          value={ctx.value || null}
          type="stock"
          disabled={ctx.disabled}
          className="min-w-60"
          onBlur={ctx.onBlur}
          onChange={(id, item) => {
            ctx.setValue(id ?? '')
            const ref = item ? toItemRef(item) : null
            set(ctx.index, {
              item: ref,
              unitId: ref?.base_unit_id ?? '',
              unitCode: ref?.base_unit?.code ?? '',
              factor: '1',
              lotNo: '',
              expiryDate: '',
              serials: '',
            })
            if (ref && !ref.base_unit?.code) labelBaseUnit(ctx.index, ref)
          }}
        />
      ),
    },
    {
      id: 'unitId',
      header: t('lines.unit'),
      width: '7.5rem',
      render: (ctx) => (
        <UnitCell
          cell={ctx.cell}
          inputRef={ctx.ref}
          value={ctx.value}
          item={ctx.line.item}
          unitCode={ctx.line.unitCode}
          disabled={ctx.disabled}
          onBlur={ctx.onBlur}
          onPick={(u) => {
            ctx.setValue(u.id)
            set(ctx.index, { unitCode: u.code, factor: u.factor })
          }}
        />
      ),
    },
    {
      id: 'quantity',
      header: t('lines.quantity'),
      width: '9rem',
      align: 'right',
      render: (ctx) => {
        const base = ctx.line.factor !== '1' ? baseQuantity(ctx.value, ctx.line.factor) : null
        return (
          <div>
            <DecimalInput
              {...ctx.cell}
              ref={ctx.ref}
              scale={6}
              displayMinFraction={0}
              allowNegative={rules.signed}
              value={ctx.value}
              disabled={ctx.disabled}
              locale={locale}
              className="h-control-sm"
              onChange={ctx.setValue}
              onBlur={ctx.onBlur}
            />
            {base !== null && (
              <p
                className="px-1 pt-0.5 text-right text-2xs text-muted-foreground tabular-nums"
                data-testid={`base-preview-${ctx.index}`}
              >
                {t('lines.baseQuantity', {
                  quantity: qty(base),
                  unit: ctx.line.item?.base_unit?.code ?? '',
                })}
              </p>
            )}
          </div>
        )
      },
    },
  ]

  if (rules.cost) {
    columns.push(
      {
        id: 'unitCost',
        header: t('lines.unitCost'),
        width: '9rem',
        align: 'right',
        render: (ctx) => (
          <DecimalInput
            {...ctx.cell}
            ref={ctx.ref}
            scale={6}
            displayMinFraction={2}
            value={ctx.value}
            disabled={ctx.disabled}
            locale={locale}
            aria-required={rules.costRequired || undefined}
            className="h-control-sm"
            onChange={ctx.setValue}
            onBlur={ctx.onBlur}
          />
        ),
      },
      {
        id: 'lineCost',
        header: t('lines.lineCost'),
        width: '8.5rem',
        align: 'right',
        readOnly: true,
        render: ({ line }) => {
          const cost = lineCost(line.quantity, line.unitCost)
          return (
            <span className="tabular-nums">
              {cost ? formatDecimalDisplay(cost.toFixed(2), { locale }) : '—'}
            </span>
          )
        },
      },
    )
  }

  if (showLot) {
    columns.push({
      id: 'lotNo',
      header: t('lines.lot'),
      width: '9rem',
      render: (ctx) =>
        ctx.line.item?.tracking === 'lot' ? (
          <Input
            {...ctx.cell}
            ref={ctx.ref}
            value={ctx.value}
            disabled={ctx.disabled}
            maxLength={64}
            placeholder={rules.lotRequired ? undefined : 'FEFO'}
            title={rules.lotRequired ? undefined : t('lines.fefo')}
            className="h-control-sm font-code"
            onChange={(e) => ctx.setValue(e.target.value)}
            onBlur={ctx.onBlur}
          />
        ) : (
          <NotApplicable cell={ctx.cell} />
        ),
    })
  }
  if (showExpiry) {
    columns.push({
      id: 'expiryDate',
      header: t('lines.expiry'),
      width: '9rem',
      render: (ctx) =>
        ctx.line.item?.has_expiry ? (
          <DateInput
            {...ctx.cell}
            ref={ctx.ref}
            value={ctx.value}
            disabled={ctx.disabled}
            className="h-control-sm"
            onChange={ctx.setValue}
            onBlur={ctx.onBlur}
          />
        ) : (
          <NotApplicable cell={ctx.cell} />
        ),
    })
  }
  if (showSerials) {
    columns.push({
      id: 'serials',
      header: t('lines.serials'),
      width: '9rem',
      render: (ctx) =>
        ctx.line.item?.tracking === 'serial' ? (
          <SerialsCell
            cell={ctx.cell}
            buttonRef={ctx.ref}
            value={ctx.value}
            index={ctx.index}
            disabled={ctx.disabled}
            required={baseQuantity(ctx.line.quantity, ctx.line.factor)}
            onSave={(v) => {
              ctx.setValue(v)
              ctx.onBlur()
            }}
          />
        ) : (
          <NotApplicable cell={ctx.cell} />
        ),
    })
  }
  if (showLocation) {
    columns.push({
      id: 'locationId',
      header: t('lines.location'),
      width: '11rem',
      render: (ctx) => (
        <LocationSelect
          {...ctx.cell}
          ref={ctx.ref}
          warehouseId={warehouseId}
          value={ctx.value}
          disabled={ctx.disabled}
          className="min-w-36"
          onBlur={ctx.onBlur}
          onChange={ctx.setValue}
        />
      ),
    })
  }
  if (showTarget) {
    columns.push({
      id: 'targetLocationId',
      header: t('lines.targetLocation'),
      width: '11rem',
      render: (ctx) => (
        <LocationSelect
          {...ctx.cell}
          ref={ctx.ref}
          warehouseId={targetWarehouseId}
          value={ctx.value}
          disabled={ctx.disabled}
          className="min-w-36"
          onBlur={ctx.onBlur}
          onChange={ctx.setValue}
        />
      ),
    })
  }

  const atCap = () => getValues('lines').length >= MAX_LINES
  const refuse = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault()
    e.stopPropagation()
    platform.notify.warning(t('lines.maxReached', { max: MAX_LINES }))
  }
  /** Every path that adds a line (button, Ctrl+Enter, Enter on the last cell) stops at the cap. */
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || !atCap()) return
    const target = e.target as HTMLElement
    const cell = target.closest<HTMLElement>('[data-line-row]')
    if (!cell || target.getAttribute('aria-expanded') === 'true') return
    if (e.ctrlKey || e.metaKey) {
      refuse(e)
      return
    }
    const lastCol = columns.reduce((last, c, i) => (c.readOnly ? last : i), -1)
    const isLastRow = Number(cell.dataset.lineRow) === getValues('lines').length - 1
    if (isLastRow && Number(cell.dataset.lineCol) === lastCol) refuse(e)
  }
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    const button = (e.target as HTMLElement).closest('button')
    if (button && !button.closest('table') && !button.closest('[role="dialog"]') && atCap())
      refuse(e)
  }

  return (
    <div className="space-y-2" onKeyDownCapture={onKeyDownCapture} onClickCapture={onClickCapture}>
      <DocumentLinesEditor<DocValues, LineValues>
        name="lines"
        label={t('lines.title')}
        columns={columns}
        newLine={emptyLine}
        minLines={1}
        disabled={disabled}
        footer={(rows) => {
          const totals = docTotals(rows, rules)
          return (
            <div
              className="flex flex-wrap items-center justify-between gap-3 text-xs"
              data-testid="doc-totals"
            >
              <span className="text-muted-foreground">
                {t('lines.count', { count: rows.length, max: MAX_LINES })}
              </span>
              <span className="flex flex-wrap items-center gap-4 tabular-nums">
                <span>{t('totals.lines', { count: totals.lines })}</span>
                {totals.quantities.length > 0 && (
                  <span>
                    {t('totals.quantity')}:{' '}
                    {totals.quantities.map((q) => `${qty(q.quantity)} ${q.unit}`).join(' · ')}
                  </span>
                )}
                {totals.cost !== null && (
                  <span className="font-semibold">
                    {t('totals.cost')}: {formatDecimalDisplay(totals.cost, { locale })}
                  </span>
                )}
              </span>
            </div>
          )
        }}
      />
    </div>
  )
}
