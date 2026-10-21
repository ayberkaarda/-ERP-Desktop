import { useMemo } from 'react'
import { Combobox, type ComboboxOption, type ComboboxProps } from '@/components/shared/form'
import {
  useCostCenters,
  useCurrencies,
  usePaymentTerms,
  useTaxCodes,
  useWarehouses,
} from '../hooks/useReference'
import type { CostCenter, Currency, PaymentTerm, TaxCode, Warehouse } from '../types'
import { taxRateLabel } from '../utils'

type BaseProps = Omit<ComboboxProps, 'options' | 'value' | 'onChange' | 'filter' | 'loading'>

interface SelectProps<T> extends BaseProps {
  value: string | null
  onChange: (value: string | null, row: T | null) => void
}

function useSelect<T>(
  rows: T[] | undefined,
  toOption: (row: T) => ComboboxOption,
  onChange: (value: string | null, row: T | null) => void,
) {
  const entries = useMemo(
    () => (rows ?? []).map((row) => ({ row, option: toOption(row) })),
    // toOption is a module-level function in every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows],
  )
  return {
    options: entries.map((e) => e.option),
    handleChange: (value: string | null) =>
      onChange(value, entries.find((e) => e.option.value === value)?.row ?? null),
  }
}

const currencyOption = (c: Currency) => ({
  value: c.code,
  label: `${c.code} · ${c.name}`,
  description: c.symbol,
})

export interface CurrencySelectProps extends SelectProps<Currency> {
  /** Only currencies activated for the company (default). */
  includeInactive?: boolean
}

/** Value is the ISO 4217 code. */
export function CurrencySelect({
  value,
  onChange,
  includeInactive,
  ...props
}: CurrencySelectProps) {
  const query = useCurrencies({ activeOnly: !includeInactive })
  const { options, handleChange } = useSelect(query.data, currencyOption, onChange)
  return (
    <Combobox
      clearable
      {...props}
      value={value}
      options={options}
      loading={query.isLoading}
      onChange={handleChange}
    />
  )
}

const taxOption = (c: TaxCode) => {
  const rate = taxRateLabel(c)
  return {
    value: c.id,
    label: `${c.code} · ${c.name}`,
    description: rate ?? undefined,
  }
}

export interface TaxCodeSelectProps extends SelectProps<TaxCode> {
  /** Restrict to one tax type, e.g. "vat". */
  type?: TaxCode['type']
}

export function TaxCodeSelect({ value, onChange, type, ...props }: TaxCodeSelectProps) {
  const query = useTaxCodes({ type })
  const { options, handleChange } = useSelect(query.data, taxOption, onChange)
  return (
    <Combobox
      clearable
      {...props}
      value={value}
      options={options}
      loading={query.isLoading}
      onChange={handleChange}
    />
  )
}

const termOption = (p: PaymentTerm) => ({
  value: p.id,
  label: `${p.code} · ${p.name}`,
  description: `${p.due_days}`,
})

export function PaymentTermSelect({ value, onChange, ...props }: SelectProps<PaymentTerm>) {
  const query = usePaymentTerms()
  const { options, handleChange } = useSelect(query.data, termOption, onChange)
  return (
    <Combobox
      clearable
      {...props}
      value={value}
      options={options}
      loading={query.isLoading}
      onChange={handleChange}
    />
  )
}

const warehouseOption = (w: Warehouse) => ({
  value: w.id,
  label: `${w.code} · ${w.name}`,
})

export function WarehouseSelect({ value, onChange, ...props }: SelectProps<Warehouse>) {
  const query = useWarehouses()
  const { options, handleChange } = useSelect(query.data, warehouseOption, onChange)
  return (
    <Combobox
      clearable
      {...props}
      value={value}
      options={options}
      loading={query.isLoading}
      onChange={handleChange}
    />
  )
}

const costCenterOption = (c: CostCenter) => ({
  value: c.id,
  label: `${c.code} · ${c.name}`,
  disabled: !c.is_active,
})

/** Internal: also usable by other features through the hooks, kept off the public surface. */
export function CostCenterSelect({ value, onChange, ...props }: SelectProps<CostCenter>) {
  const query = useCostCenters()
  const { options, handleChange } = useSelect(query.data, costCenterOption, onChange)
  return (
    <Combobox
      clearable
      {...props}
      value={value}
      options={options}
      loading={query.isLoading}
      onChange={handleChange}
    />
  )
}
