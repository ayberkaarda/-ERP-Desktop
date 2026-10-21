import { useMemo } from 'react'
import { Combobox, type ComboboxOption, type ComboboxProps } from '@/components/shared/form'
import { toIsoDate } from '@/lib/datetime'
import {
  useCostCenters,
  useCurrencies,
  usePaymentTerms,
  useTaxCodes,
  useWarehouses,
} from '../hooks/useReference'
import type { CostCenter, Currency, PaymentTerm, TaxCode, Warehouse } from '../types'
import { taxRateLabel, taxValidity } from '../utils'
import { LoadError } from './LoadError'

type BaseProps = Omit<ComboboxProps, 'options' | 'value' | 'onChange' | 'filter' | 'loading'>

interface SelectProps<T> extends BaseProps {
  value: string | null
  onChange: (value: string | null, row: T | null) => void
}

interface LookupQuery<T> {
  data: T[] | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => unknown
}

interface LookupSelectProps<T> extends SelectProps<T> {
  query: LookupQuery<T>
  toOption: (row: T) => ComboboxOption
  rowKey: (row: T) => string
}

/** Combobox over a looked-up list; a failed lookup shows an alert with retry, not an empty list. */
function LookupSelect<T>({
  query,
  toOption,
  rowKey,
  value,
  onChange,
  ...props
}: LookupSelectProps<T>) {
  const rows = query.data
  const options = useMemo(() => (rows ?? []).map(toOption), [rows, toOption])
  if (query.isError) {
    return <LoadError error={query.error} onRetry={() => void query.refetch()} />
  }
  return (
    <Combobox
      clearable
      {...props}
      value={value}
      options={options}
      loading={query.isLoading}
      onChange={(next) => onChange(next, (rows ?? []).find((row) => rowKey(row) === next) ?? null)}
    />
  )
}

const currencyOption = (c: Currency): ComboboxOption => ({
  value: c.code,
  label: `${c.code} · ${c.name}`,
  description: c.symbol,
})
const currencyKey = (c: Currency) => c.code

export interface CurrencySelectProps extends SelectProps<Currency> {
  /** Also offer currencies not activated for the company. */
  includeInactive?: boolean
}

/** Value is the ISO 4217 code. */
export function CurrencySelect({ includeInactive, ...props }: CurrencySelectProps) {
  const query = useCurrencies({ activeOnly: !includeInactive })
  return <LookupSelect query={query} toOption={currencyOption} rowKey={currencyKey} {...props} />
}

const taxOption = (c: TaxCode): ComboboxOption => ({
  value: c.id,
  label: `${c.code} · ${c.name}`,
  description: taxRateLabel(c) ?? undefined,
})
const idKey = (row: { id: string }) => row.id

export interface TaxCodeSelectProps extends SelectProps<TaxCode> {
  /** Restrict to one tax type, e.g. "vat". */
  type?: TaxCode['type']
  /** Only codes effective on this calendar date (YYYY-MM-DD); defaults to today. */
  asOf?: string
}

export function TaxCodeSelect({ type, asOf, ...props }: TaxCodeSelectProps) {
  const query = useTaxCodes({ type })
  const date = asOf ?? toIsoDate(new Date())
  const effective = useMemo(
    () => ({
      ...query,
      data: query.data?.filter((c) => taxValidity(c, date) === 'active'),
    }),
    [query, date],
  )
  return <LookupSelect query={effective} toOption={taxOption} rowKey={idKey} {...props} />
}

const termOption = (p: PaymentTerm): ComboboxOption => ({
  value: p.id,
  label: `${p.code} · ${p.name}`,
  description: `${p.due_days}`,
})

export function PaymentTermSelect(props: SelectProps<PaymentTerm>) {
  const query = usePaymentTerms()
  return <LookupSelect query={query} toOption={termOption} rowKey={idKey} {...props} />
}

const warehouseOption = (w: Warehouse): ComboboxOption => ({
  value: w.id,
  label: `${w.code} · ${w.name}`,
})

export function WarehouseSelect(props: SelectProps<Warehouse>) {
  const query = useWarehouses()
  return <LookupSelect query={query} toOption={warehouseOption} rowKey={idKey} {...props} />
}

const costCenterOption = (c: CostCenter): ComboboxOption => ({
  value: c.id,
  label: `${c.code} · ${c.name}`,
  disabled: !c.is_active,
})

/** Internal to this feature (project form). */
export function CostCenterSelect(props: SelectProps<CostCenter>) {
  const query = useCostCenters()
  return <LookupSelect query={query} toOption={costCenterOption} rowKey={idKey} {...props} />
}
