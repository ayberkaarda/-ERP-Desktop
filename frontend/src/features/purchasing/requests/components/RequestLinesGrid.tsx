import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { DateInput, MoneyInput } from '@/components/shared/form'
import { DocumentLinesEditor, type LineColumn } from '@/components/shared/lines/DocumentLinesEditor'
import { useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { ItemCell, QuantityCell, UnitCell } from '../../shared/components/LineCells'
import { bind } from '../../shared/lib/ui'
import { SupplierPicker } from '../../shared/components/SupplierPicker'
import { dec, isDecimal } from '../../shared/lib/forms'
import {
  emptyRequestLine,
  type RequestLineValues,
  type RequestValues,
} from '../../shared/lib/requestForm'

/** Request lines: item, quantity, unit, estimated price, suggested supplier, needed-by date. */
export function RequestLinesGrid({
  disabled = false,
  currency,
}: {
  disabled?: boolean
  currency: string
}) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const { control, setValue } = useFormContext<RequestValues>()
  useWatch({ control, name: 'lines' })

  const set = (index: number, patch: Partial<RequestLineValues>) => {
    for (const [key, value] of Object.entries(patch)) {
      setValue(`lines.${index}.${key as keyof RequestLineValues}`, value as never, {
        shouldDirty: true,
        shouldValidate: false,
      })
    }
  }

  const columns: LineColumn<RequestLineValues>[] = [
    {
      id: 'itemId',
      header: t('lines.item'),
      width: '17rem',
      render: (ctx) => (
        <ItemCell b={bind(ctx)} inputRef={ctx.ref} quantity={ctx.line.quantity} set={set} />
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
      id: 'estimatedPrice',
      header: t('lines.estimatedPrice'),
      width: '9rem',
      align: 'right',
      render: (ctx) => (
        <MoneyInput
          {...ctx.cell}
          ref={ctx.ref}
          scale={6}
          displayMinFraction={2}
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
      id: 'suggestedSupplierId',
      header: t('lines.suggestedSupplier'),
      width: '14rem',
      render: (ctx) => (
        <SupplierPicker
          {...ctx.cell}
          ref={ctx.ref}
          clearable
          value={ctx.value}
          name={ctx.line.suggestedSupplierName || undefined}
          disabled={ctx.disabled}
          className="min-w-48"
          onBlur={ctx.onBlur}
          onChange={(id, party) => {
            ctx.setValue(id ?? '')
            set(ctx.index, { suggestedSupplierName: party?.name ?? '' })
          }}
        />
      ),
    },
    {
      id: 'neededBy',
      header: t('lines.neededBy'),
      width: '9rem',
      render: (ctx) => (
        <DateInput
          {...ctx.cell}
          ref={ctx.ref}
          value={ctx.value}
          disabled={ctx.disabled}
          className="h-control-sm"
          onChange={ctx.setValue}
          onBlur={ctx.onBlur}
        />
      ),
    },
    {
      id: 'estimatedTotal',
      header: t('lines.estimatedTotal'),
      width: '8rem',
      align: 'right',
      readOnly: true,
      render: (ctx) =>
        isDecimal(ctx.line.quantity) && isDecimal(ctx.line.estimatedPrice) ? (
          <span className="tabular-nums">
            {formatMoney(
              dec(ctx.line.quantity).mul(dec(ctx.line.estimatedPrice)).toFixed(2),
              currency,
              locale,
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ]

  return (
    <DocumentLinesEditor<RequestValues, RequestLineValues>
      name="lines"
      columns={columns}
      newLine={emptyRequestLine}
      minLines={1}
      label={t('lines.title')}
      disabled={disabled}
    />
  )
}
