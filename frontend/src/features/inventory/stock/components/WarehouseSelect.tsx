import type { FieldControlProps } from '@/components/shared/form'
import { useInvT } from '../lib/i18n'
import { useAllWarehouses } from '../lib/queries'
import type { CodeRef } from '../lib/types'
import { useCanListWarehouses } from '../lib/warehouseOptions'
import { NativeSelect } from './common'

interface WarehouseSelectProps extends Partial<FieldControlProps> {
  value: string
  onChange: (id: string) => void
  /** Label of the empty choice ("all warehouses"). */
  emptyLabel?: string
  includeInactive?: boolean
  /**
   * Warehouses seen in the page's rows. Users without warehouse access cannot call
   * /warehouses, so the picker offers these instead (no request is made).
   */
  known?: readonly CodeRef[]
  className?: string
}

/** Warehouse picker fed by the company's warehouse list, or by `known` without access to it. */
export function WarehouseSelect({
  value,
  onChange,
  emptyLabel,
  includeInactive = true,
  known = [],
  className,
  ...control
}: WarehouseSelectProps) {
  const t = useInvT()
  const canList = useCanListWarehouses()
  const { data = [], isPending } = useAllWarehouses(canList)
  const options = canList
    ? data
        .filter((w) => includeInactive || w.is_active || w.id === value)
        .map((w) => ({
          value: w.id,
          label: `${w.code} · ${w.name}${w.is_active ? '' : ` (${t('common.inactive')})`}`,
        }))
    : known.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))
  // Until the list arrives a chosen id still needs an option, or the select would drop it.
  if (value && !options.some((o) => o.value === value)) options.unshift({ value, label: value })
  return (
    <NativeSelect
      {...control}
      className={className}
      value={value}
      disabled={canList && isPending && !value}
      emptyLabel={emptyLabel ?? t('common.allWarehouses')}
      options={options}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
