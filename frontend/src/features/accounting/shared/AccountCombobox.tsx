import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, type Ref } from 'react'
import { DEFAULT_LIST_QUERY } from '@/components/shared/data-table'
import {
  AsyncCombobox,
  type ComboboxOption,
  type FieldControlProps,
} from '@/components/shared/form'
import { cn } from '@/lib/utils'
import { accountsApi } from './api'
import { AccountTypeBadge } from './components'
import { useAccT } from './i18n'
import { accKeys } from './keys'
import type { Account } from './types'

export interface AccountComboboxProps extends Partial<FieldControlProps> {
  value: string | null
  /** The picked account comes along (dimension flags, currency, normal balance). */
  onChange: (id: string | null, account: Account | null) => void
  onBlur?: () => void
  ref?: Ref<HTMLInputElement>
  /** Only accounts that accept postings (leaf accounts). Default true. */
  postableOnly?: boolean
  disabled?: boolean
  placeholder?: string
  className?: string
  'aria-label'?: string
}

/**
 * Async account picker: searches code and name (server `q`), active accounts only, optionally
 * postable ones only. Each option shows the type and normal balance; the picked account's type
 * is shown as a badge next to the field.
 */
export function AccountCombobox({
  value,
  onChange,
  postableOnly = true,
  className,
  ...props
}: AccountComboboxProps) {
  const t = useAccT()
  const queryClient = useQueryClient()
  // Rows of the latest search: a pick returns exactly the record the user saw.
  const lastResults = useRef(new Map<string, Account>())
  const current = useQuery({
    queryKey: accKeys.account(value ?? ''),
    queryFn: ({ signal }) => accountsApi.get(value ?? '', signal),
    enabled: Boolean(value),
    staleTime: 5 * 60_000,
  })
  const known = value ? current.data : undefined

  const toOption = (a: Account): ComboboxOption => ({
    value: a.id,
    label: `${a.code} · ${a.name}`,
    description: [
      t(`accounts.types.${a.type}`),
      t(`accounts.normal.${a.normal_balance}`),
      a.is_postable ? null : t('accounts.combobox.header'),
      a.currency_code,
    ]
      .filter(Boolean)
      .join(' · '),
    disabled: postableOnly && !a.is_postable,
  })

  const loadOptions = async (q: string, signal: AbortSignal) => {
    const filters: Record<string, string> = { is_active: 'true' }
    if (postableOnly) filters.is_postable = 'true'
    const res = await accountsApi.list(
      { ...DEFAULT_LIST_QUERY, perPage: 25, q, filters, sort: [{ id: 'code', desc: false }] },
      signal,
    )
    // The server filters already; this keeps the contract if a filter is ignored.
    const rows = res.data.filter((a) => a.is_active && (!postableOnly || a.is_postable))
    lastResults.current = new Map(rows.map((a) => [a.id, a]))
    return rows.map(toOption)
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <AsyncCombobox
        key={value && !known ? 'pending' : 'ready'}
        {...props}
        className="min-w-0 flex-1"
        value={value}
        clearable
        emptyText={t('accounts.combobox.empty')}
        scopeKey={postableOnly ? 'postable' : 'all'}
        initialOption={known ? toOption(known) : value ? { value, label: value } : null}
        loadOptions={loadOptions}
        onChange={(id) => {
          const picked = id ? lastResults.current.get(id) : undefined
          if (picked) queryClient.setQueryData(accKeys.account(picked.id), picked)
          onChange(
            id,
            picked ??
              (id ? (queryClient.getQueryData<Account>(accKeys.account(id)) ?? null) : null),
          )
        }}
      />
      {known && <AccountTypeBadge type={known.type} />}
    </div>
  )
}
