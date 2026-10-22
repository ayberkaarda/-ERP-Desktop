import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { DecimalInput, MoneyInput } from '@/components/shared/form'
import { DocumentLinesEditor, type LineColumn } from '@/components/shared/lines/DocumentLinesEditor'
import { TaxCodeSelect } from '@/features/reference'
import { useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { ItemCell, QuantityCell, UnitCell } from '../../shared/components/LineCells'
import { bind } from '../../shared/lib/ui'
import { dec, trimDecimal } from '../../shared/lib/forms'
import { emptyOrderLine, type OrderLineValues, type OrderValues } from '../../shared/lib/orderForm'
import type { PreviewLine } from '../../shared/types'

interface OrderLinesGridProps {
  disabled?: boolean
  /** Server results by line key (preview, or the stored lines while unchanged). */
  preview: ReadonlyMap<string, PreviewLine>
  pending?: boolean
}

/**
 * Order lines on the shared DocumentLinesEditor: item (purchase tax as default), quantity with
 * base-unit preview, unit, supplier price, discounts, VAT, withholding and the server line total.
 */
export function OrderLinesGrid({
  disabled = false,
  preview,
  pending = false,
}: OrderLinesGridProps) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const { control, setValue } = useFormContext<OrderValues>()
  const currency = useWatch({ control, name: 'currencyCode' })
  const documentDate = useWatch({ control, name: 'documentDate' })

  const set = (index: number, patch: Partial<OrderLineValues>) => {
    for (const [key, value] of Object.entries(patch)) {
      setValue(`lines.${index}.${key as keyof OrderLineValues}`, value as never, {
        shouldDirty: true,
        shouldValidate: false,
      })
    }
  }

  const columns: LineColumn<OrderLineValues>[] = [
    {
      id: 'itemId',
      header: t('lines.item'),
      width: '16rem',
      render: (ctx) => (
        <ItemCell
          b={bind(ctx)}
          inputRef={ctx.ref}
          quantity={ctx.line.quantity}
          set={set}
          extra={(item) => ({ taxCodeId: item.tax_code_id ?? '', priceSource: '' })}
        />
      ),
    },
    {
      id: 'quantity',
      header: t('lines.quantity'),
      width: '8rem',
      align: 'right',
      render: (ctx) => (
        <QuantityCell
          b={bind(ctx)}
          inputRef={ctx.ref}
          factor={ctx.line.factor}
          baseUnitCode={ctx.line.item?.base_unit_code}
        />
      ),
    },
    {
      id: 'unitId',
      header: t('lines.unit'),
      width: '6.5rem',
      render: (ctx) => (
        <UnitCell
          b={bind(ctx)}
          inputRef={ctx.ref}
          item={ctx.line.item}
          unitCode={ctx.line.unitCode}
          onPick={(u) => set(ctx.index, { unitCode: u.code, factor: u.factor })}
        />
      ),
    },
    {
      id: 'unitPrice',
      header: t('lines.unitPrice'),
      width: '9rem',
      align: 'right',
      render: (ctx) => (
        <div>
          <MoneyInput
            {...ctx.cell}
            ref={ctx.ref}
            scale={6}
            displayMinFraction={2}
            currency={currency}
            value={ctx.value}
            disabled={ctx.disabled}
            className="h-control-sm text-right"
            onChange={(v) => {
              ctx.setValue(v)
              if (ctx.line.priceSource) set(ctx.index, { priceSource: 'manual' })
            }}
            onBlur={ctx.onBlur}
          />
          {(ctx.line.priceSource === 'quote' || ctx.line.priceSource === 'request') && (
            <p className="px-1 pt-0.5 text-left text-2xs text-muted-foreground">
              {t(`lines.priceSource.${ctx.line.priceSource}`)}
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'discountPercent',
      header: t('lines.discountPercent'),
      width: '5.5rem',
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
      width: '7.5rem',
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
      width: '8.5rem',
      render: (ctx) => (
        <TaxCodeSelect
          {...ctx.cell}
          ref={ctx.ref}
          type="vat"
          value={ctx.value || null}
          asOf={documentDate || undefined}
          disabled={ctx.disabled}
          className="min-w-28"
          onBlur={ctx.onBlur}
          onChange={(v) => ctx.setValue(v ?? '')}
        />
      ),
    },
    {
      id: 'withholdingCodeId',
      header: t('lines.withholding'),
      width: '8.5rem',
      render: (ctx) => (
        <TaxCodeSelect
          {...ctx.cell}
          ref={ctx.ref}
          type="withholding"
          value={ctx.value || null}
          asOf={documentDate || undefined}
          disabled={ctx.disabled || !ctx.line.taxCodeId}
          className="min-w-28"
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
              {!dec(r.withholding_amount).isZero() &&
                ` · ${t('lines.withheld', { amount: formatMoney(r.withholding_amount, currency, locale) })}`}
            </span>
          </span>
        )
      },
    },
  ]

  return (
    <DocumentLinesEditor<OrderValues, OrderLineValues>
      name="lines"
      columns={columns}
      newLine={emptyOrderLine}
      minLines={1}
      label={t('lines.title')}
      disabled={disabled}
    />
  )
}
