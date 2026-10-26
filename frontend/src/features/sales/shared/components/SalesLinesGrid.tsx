import Decimal from 'decimal.js'
import type { RefCallback } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Combobox, DecimalInput, MoneyInput, QuantityInput } from '@/components/shared/form'
import {
  DocumentLinesEditor,
  type LineCellProps,
  type LineColumn,
} from '@/components/shared/lines/DocumentLinesEditor'
import { Input } from '@/components/ui/input'
import { ItemCombobox } from '@/features/catalog'
import { TaxCodeSelect } from '@/features/reference'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay, formatMoney } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { useItemStock, useItemUnits } from '../hooks/queries'
import { stockHint } from '../lib/insights'
import {
  baseQuantity,
  dec,
  emptyLine,
  priceSourceGroup,
  toLineItem,
  trimDecimal,
  type DocValues,
  type LineItem,
  type LineValues,
} from '../lib/lines'
import { SALES_ACCESS, SALES_PERMS } from '../permissions'
import type { PreviewLine } from '../types'

interface SalesLinesGridProps {
  disabled?: boolean
  /** Server results of the last preview, by line key. */
  preview: ReadonlyMap<string, PreviewLine>
  /** The preview is behind the form. */
  pending?: boolean
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
  item: LineItem | null
  unitCode: string
  disabled: boolean
  onBlur: () => void
  onPick: (unit: { id: string; code: string; factor: string }) => void
}) {
  const units = useItemUnits(item?.base_unit_id ? item : null)
  const options = (units.data ?? []).map((u) => ({
    value: u.unit_id,
    label: u.code || u.name,
    description: u.factor === '1' ? undefined : `× ${trimDecimal(u.factor)}`,
  }))
  return (
    <Combobox
      {...cell}
      ref={inputRef}
      value={value || null}
      selectedOption={value ? { value, label: unitCode || value } : null}
      options={options}
      loading={units.isLoading}
      disabled={disabled || !item}
      className="min-w-20"
      onBlur={onBlur}
      onChange={(id) => {
        const unit = units.data?.find((u) => u.unit_id === id)
        if (unit) onPick({ id: unit.unit_id, code: unit.code, factor: unit.factor })
      }}
    />
  )
}

/** Availability of the line's item against everything this document asks of it. */
function StockHintText({
  index,
  item,
  needed,
  warehouseId,
}: {
  index: number
  item: LineItem
  needed: Decimal
  warehouseId: string
}) {
  const { t } = useTranslation('sales-shared')
  const locale = useIntlLocale()
  const stock = useItemStock(item.id, item.type === 'stock')
  const hint = stockHint(stock.data, warehouseId, needed)
  if (!hint) return null
  const qty = formatDecimalDisplay(hint.available, { locale, minFraction: 0, maxFraction: 6 })
  const unit = item.base_unit_code ?? ''
  return (
    <p
      data-testid={`stock-hint-${index}`}
      className={cn(
        'px-1 pt-0.5 text-left text-2xs',
        hint.tone === 'short' && 'text-danger',
        hint.tone === 'low' && 'text-warning-soft-foreground',
        hint.tone === 'ok' && 'text-muted-foreground',
      )}
    >
      {t(`lines.stock.${hint.tone}`, { quantity: qty, unit })}
    </p>
  )
}

/**
 * Sales lines on the shared DocumentLinesEditor: item, quantity with base-unit preview and stock
 * hint, unit with conversion, price (resolved by the server unless overridden), discount %,
 * discount amount, tax code and the server line total.
 */
export function SalesLinesGrid({
  disabled = false,
  preview,
  pending = false,
}: SalesLinesGridProps) {
  const { t } = useTranslation('sales-shared')
  const locale = useIntlLocale()
  const { control, setValue } = useFormContext<DocValues>()
  const lines = useWatch({ control, name: 'lines' })
  const currency = useWatch({ control, name: 'currencyCode' })
  const documentDate = useWatch({ control, name: 'documentDate' })
  const warehouseId = useWatch({ control, name: 'warehouseId' })
  const canOverride = usePermission(SALES_PERMS.priceOverride)
  const canSeeStock = usePermission(SALES_ACCESS.stockHint)
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

  /** Base quantity the whole document asks of an item (all its lines). */
  const neededOf = (itemId: string) =>
    lines.reduce(
      (acc, l) => (l.itemId === itemId ? acc.plus(dec(baseQuantity(l.quantity, l.factor))) : acc),
      new Decimal(0),
    )

  const columns: LineColumn<LineValues>[] = [
    {
      id: 'itemId',
      header: t('lines.item'),
      width: '17rem',
      render: (ctx) => (
        <ItemCombobox
          {...ctx.cell}
          ref={ctx.ref}
          value={ctx.value || null}
          disabled={ctx.disabled}
          className="min-w-56"
          onBlur={ctx.onBlur}
          onChange={(id, item) => {
            ctx.setValue(id ?? '')
            if (!id || !item) {
              set(ctx.index, { item: null, unitId: '', unitCode: '', factor: '1', variantId: '' })
              return
            }
            const picked = toLineItem(item)
            set(ctx.index, {
              item: picked,
              // A variant belongs to the previous item.
              variantId: '',
              unitId: picked.base_unit_id,
              unitCode: picked.base_unit_code ?? '',
              factor: '1',
              taxCodeId: picked.default_tax_code_id ?? '',
              quantity: ctx.line.quantity || '1',
            })
          }}
        />
      ),
    },
    {
      id: 'quantity',
      header: t('lines.quantity'),
      width: '8.5rem',
      align: 'right',
      render: (ctx) => {
        const base = baseQuantity(ctx.value, ctx.line.factor)
        const showBase = base !== null && ctx.line.factor !== '1' && dec(ctx.line.factor).gt(0)
        return (
          <div>
            <QuantityInput
              {...ctx.cell}
              ref={ctx.ref}
              scale={6}
              value={ctx.value}
              disabled={ctx.disabled}
              className="h-control-sm text-right"
              onChange={ctx.setValue}
              onBlur={ctx.onBlur}
            />
            {showBase && (
              <p
                data-testid={`base-preview-${ctx.index}`}
                className="px-1 pt-0.5 text-left text-2xs text-muted-foreground"
              >
                = {qty(base)} {ctx.line.item?.base_unit_code ?? ''}
              </p>
            )}
            {canSeeStock && ctx.line.item?.type === 'stock' && (
              <StockHintText
                index={ctx.index}
                item={ctx.line.item}
                needed={neededOf(ctx.line.itemId)}
                warehouseId={warehouseId}
              />
            )}
          </div>
        )
      },
    },
    {
      id: 'unitId',
      header: t('lines.unit'),
      width: '6.5rem',
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
      id: 'unitPrice',
      header: t('lines.unitPrice'),
      width: '9rem',
      align: 'right',
      render: (ctx) => {
        const resolved = preview.get(ctx.line.key)
        const manual = ctx.value.trim() !== ''
        // The price list price when one resolves (an override shows it as the hint).
        const listPrice = manual ? (resolved?.resolved_price ?? null) : null
        const resolvedText = resolved
          ? formatDecimalDisplay(trimDecimal(listPrice ?? resolved.unit_price), {
              locale,
              minFraction: 2,
              maxFraction: 4,
            })
          : ''
        const source = manual
          ? t('lines.priceManual')
          : resolved
            ? t(`lines.priceSource.${priceSourceGroup(resolved.price_source)}`)
            : ''
        return (
          <div>
            {canOverride ? (
              <MoneyInput
                {...ctx.cell}
                ref={ctx.ref}
                scale={4}
                currency={currency}
                value={ctx.value}
                placeholder={resolvedText || t('lines.pricePlaceholder')}
                disabled={ctx.disabled}
                className="h-control-sm text-right"
                onChange={ctx.setValue}
                onBlur={ctx.onBlur}
              />
            ) : (
              <Input
                {...ctx.cell}
                ref={ctx.ref}
                readOnly
                value={resolvedText}
                placeholder={t('lines.pricePlaceholder')}
                title={t('lines.priceLocked')}
                className="h-control-sm bg-surface-sunken text-right tabular-nums"
              />
            )}
            {source && (
              <p className="px-1 pt-0.5 text-left text-2xs text-muted-foreground">{source}</p>
            )}
          </div>
        )
      },
    },
    {
      id: 'discountPercent',
      header: t('lines.discountPercent'),
      width: '6rem',
      align: 'right',
      render: (ctx) => (
        <DecimalInput
          {...ctx.cell}
          ref={ctx.ref}
          scale={4}
          displayMinFraction={0}
          suffix="%"
          value={ctx.value}
          disabled={ctx.disabled}
          className="h-control-sm text-right"
          onChange={ctx.setValue}
          onBlur={ctx.onBlur}
        />
      ),
    },
    {
      id: 'discountAmount',
      header: t('lines.discountAmount'),
      width: '8rem',
      align: 'right',
      render: (ctx) => (
        <MoneyInput
          {...ctx.cell}
          ref={ctx.ref}
          scale={4}
          currency={currency}
          value={ctx.value}
          disabled={ctx.disabled}
          className="h-control-sm text-right"
          onChange={ctx.setValue}
          onBlur={ctx.onBlur}
        />
      ),
    },
    {
      id: 'taxCodeId',
      header: t('lines.tax'),
      width: '9rem',
      render: (ctx) => (
        <TaxCodeSelect
          {...ctx.cell}
          ref={ctx.ref}
          value={ctx.value || null}
          asOf={documentDate || undefined}
          disabled={ctx.disabled}
          className="min-w-32"
          onBlur={ctx.onBlur}
          onChange={(v) => ctx.setValue(v ?? '')}
        />
      ),
    },
    {
      id: 'lineTotal',
      header: t('lines.lineTotal'),
      width: '9rem',
      align: 'right',
      readOnly: true,
      render: (ctx) => {
        const r = preview.get(ctx.line.key)
        if (!r) return <span className="text-muted-foreground">—</span>
        return (
          <span
            data-testid={`line-total-${ctx.index}`}
            className={cn('block tabular-nums', pending && 'opacity-60')}
          >
            {formatMoney(r.line_total, currency, locale)}
            <span className="block text-2xs text-muted-foreground">
              {t('lines.netTax', {
                net: formatMoney(r.net_amount, currency, locale),
                rate: trimDecimal(r.tax_rate),
              })}
            </span>
          </span>
        )
      },
    },
  ]

  return (
    <DocumentLinesEditor<DocValues, LineValues>
      name="lines"
      columns={columns}
      newLine={emptyLine}
      minLines={1}
      label={t('lines.title')}
      disabled={disabled}
    />
  )
}
