import type { RefCallback } from 'react'
import { Combobox, QuantityInput } from '@/components/shared/form'
import type { LineCellProps } from '@/components/shared/lines/DocumentLinesEditor'
import { ItemCombobox, type Item } from '@/features/catalog'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { useItemUnits } from '../hooks/queries'
import { baseQuantity, dec, toPurchLineItem, trimDecimal, type PurchLineItem } from '../lib/forms'

/** Fields every purchasing line form shares (item, unit and its factor). */
export interface ItemLineFields {
  itemId: string
  item: PurchLineItem | null
  quantity: string
  unitId: string
  unitCode: string
  factor: string
  variantId: string
}

/** What a cell gets from the lines editor (its ref is passed separately as `inputRef`). */
export interface CellBinding {
  cell: LineCellProps
  value: string
  setValue: (value: string) => void
  onBlur: () => void
  disabled: boolean
  index: number
}

/**
 * Item picker cell: picking sets the base unit, factor 1 and quantity 1 when empty; `extra`
 * adds per-form defaults (purchase tax code); clearing resets the unit.
 */
export function ItemCell<L extends ItemLineFields>({
  b,
  inputRef,
  quantity,
  set,
  extra,
}: {
  b: CellBinding
  inputRef: RefCallback<HTMLElement>
  quantity: string
  set: (index: number, patch: Partial<L>) => void
  extra?: (item: PurchLineItem, raw: Item) => Partial<L>
}) {
  return (
    <ItemCombobox
      {...b.cell}
      ref={inputRef}
      value={b.value || null}
      disabled={b.disabled}
      className="min-w-56"
      onBlur={b.onBlur}
      onChange={(id, item) => {
        b.setValue(id ?? '')
        if (!id || !item) {
          set(b.index, {
            item: null,
            unitId: '',
            unitCode: '',
            factor: '1',
            variantId: '',
          } as Partial<L>)
          return
        }
        const picked = toPurchLineItem(item)
        set(b.index, {
          item: picked,
          // A variant belongs to the previous item.
          variantId: '',
          unitId: picked.base_unit_id,
          unitCode: picked.base_unit_code ?? '',
          factor: '1',
          quantity: quantity || '1',
          ...extra?.(picked, item),
        } as Partial<L>)
      }}
    />
  )
}

/** Quantity cell with the base-unit preview ("= 24 ADET") for alternate units. */
export function QuantityCell({
  b,
  inputRef,
  factor,
  baseUnitCode,
}: {
  b: CellBinding
  inputRef: RefCallback<HTMLElement>
  factor: string
  baseUnitCode: string | null | undefined
}) {
  const locale = useIntlLocale()
  const base = baseQuantity(b.value, factor)
  const showBase = base !== null && factor !== '1' && dec(factor).gt(0)
  return (
    <div>
      <QuantityInput
        {...b.cell}
        ref={inputRef}
        scale={6}
        value={b.value}
        disabled={b.disabled}
        className="h-control-sm text-right"
        onChange={b.setValue}
        onBlur={b.onBlur}
      />
      {showBase && (
        <p
          data-testid={`base-preview-${b.index}`}
          className="px-1 pt-0.5 text-left text-2xs text-muted-foreground"
        >
          = {formatDecimalDisplay(trimDecimal(base), { locale, minFraction: 0, maxFraction: 6 })}{' '}
          {baseUnitCode ?? ''}
        </p>
      )}
    </div>
  )
}

/** The units of the line's item; picking one carries its code and factor into the line. */
export function UnitCell({
  b,
  inputRef,
  item,
  unitCode,
  onPick,
}: {
  b: CellBinding
  inputRef: RefCallback<HTMLElement>
  item: PurchLineItem | null
  unitCode: string
  onPick: (unit: { code: string; factor: string }) => void
}) {
  const units = useItemUnits(item?.base_unit_id ? item : null)
  const options = (units.data ?? []).map((u) => ({
    value: u.unit_id,
    label: u.code || u.name,
    description: u.factor === '1' ? undefined : `× ${trimDecimal(u.factor)}`,
  }))
  return (
    <Combobox
      {...b.cell}
      ref={inputRef}
      value={b.value || null}
      selectedOption={b.value ? { value: b.value, label: unitCode || b.value } : null}
      options={options}
      loading={units.isLoading}
      disabled={b.disabled || !item}
      className="min-w-20"
      onBlur={b.onBlur}
      onChange={(id) => {
        const unit = units.data?.find((u) => u.unit_id === id)
        if (!unit) return
        b.setValue(unit.unit_id)
        onPick({ code: unit.code, factor: unit.factor })
      }}
    />
  )
}
