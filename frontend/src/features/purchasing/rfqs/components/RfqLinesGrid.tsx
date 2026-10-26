import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { DateInput } from '@/components/shared/form'
import { DocumentLinesEditor, type LineColumn } from '@/components/shared/lines/DocumentLinesEditor'
import { Input } from '@/components/ui/input'
import { ItemCell, QuantityCell, UnitCell } from '../../shared/components/LineCells'
import { bind } from '../../shared/lib/ui'
import { emptyRfqLine, type RfqLineValues, type RfqValues } from '../../shared/lib/rfqForm'

/** RFQ lines: item, quantity, unit, description for the suppliers, needed-by date. */
export function RfqLinesGrid({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation('purchasing-orders')
  const { setValue } = useFormContext<RfqValues>()

  const set = (index: number, patch: Partial<RfqLineValues>) => {
    for (const [key, value] of Object.entries(patch)) {
      setValue(`lines.${index}.${key as keyof RfqLineValues}`, value as never, {
        shouldDirty: true,
        shouldValidate: false,
      })
    }
  }

  const columns: LineColumn<RfqLineValues>[] = [
    {
      id: 'itemId',
      header: t('lines.item'),
      width: '18rem',
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
      id: 'description',
      header: t('lines.description'),
      render: (ctx) => (
        <Input
          {...ctx.cell}
          ref={ctx.ref}
          value={ctx.value}
          maxLength={500}
          disabled={ctx.disabled}
          className="h-control-sm"
          onChange={(e) => ctx.setValue(e.target.value)}
          onBlur={ctx.onBlur}
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
  ]

  return (
    <DocumentLinesEditor<RfqValues, RfqLineValues>
      name="lines"
      columns={columns}
      newLine={emptyRfqLine}
      minLines={1}
      label={t('lines.title')}
      disabled={disabled}
    />
  )
}
