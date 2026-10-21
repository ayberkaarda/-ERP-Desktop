import type { FieldControlProps } from '@/components/shared/form'
import { useInvT } from '../lib/i18n'
import { useAllWarehouses } from '../lib/queries'
import { NativeSelect } from './common'

interface WarehouseSelectProps extends Partial<FieldControlProps> {
  value: string
  onChange: (id: string) => void
  /** Label of the empty choice ("all warehouses"). */
  emptyLabel?: string
  includeInactive?: boolean
  className?: string
}

/** Warehouse picker fed by the full warehouse list of the company. */
export function WarehouseSelect({
  value,
  onChange,
  emptyLabel,
  includeInactive = true,
  className,
  ...control
}: WarehouseSelectProps) {
  const t = useInvT()
  const { data = [], isPending } = useAllWarehouses()
  const options = data
    .filter((w) => includeInactive || w.is_active || w.id === value)
    .map((w) => ({
      value: w.id,
      label: `${w.code} · ${w.name}${w.is_active ? '' : ` (${t('common.inactive')})`}`,
    }))
  // Until the list arrives a chosen id still needs an option, or the select would drop it.
  if (value && !options.some((o) => o.value === value)) options.unshift({ value, label: value })
  return (
    <NativeSelect
      {...control}
      className={className}
      value={value}
      disabled={isPending && !value}
      emptyLabel={emptyLabel ?? t('common.allWarehouses')}
      options={options}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
