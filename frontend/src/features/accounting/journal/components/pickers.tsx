import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AsyncCombobox,
  type AsyncComboboxProps,
  type ComboboxOption,
} from '@/components/shared/form'
import { lookupsApi } from '../api/client'
import { accountLabel, refLabel } from '../lib/labels'
import type { AccountRef, NamedRef } from '../types'

type PassThrough = Omit<
  AsyncComboboxProps,
  'value' | 'onChange' | 'loadOptions' | 'initialOption' | 'scopeKey'
>

interface JournalAccountPickerProps extends PassThrough {
  value: string
  onChange: (id: string, account: AccountRef | null) => void
  /** The account behind `value` (edit forms), so the label shows before any search. */
  account?: AccountRef | null
  /** Only active postable (leaf) accounts; reports also allow parent accounts. */
  postableOnly?: boolean
}

/**
 * Account search by code or name over GET /accounts. Kept inside the journal feature until the
 * shared AccountCombobox lands; the option description lists the account's posting rules.
 */
export function JournalAccountPicker({
  value,
  onChange,
  account,
  postableOnly = true,
  ...props
}: JournalAccountPickerProps) {
  const { t } = useTranslation('accountingJournal')
  const seen = useRef(new Map<string, AccountRef>())

  const describe = (a: AccountRef) =>
    [
      a.currency_code ? t('picker.currency', { code: a.currency_code }) : null,
      a.requires_party ? t('picker.requiresParty') : null,
      a.requires_cost_center ? t('picker.requiresCostCenter') : null,
      a.requires_project ? t('picker.requiresProject') : null,
    ]
      .filter(Boolean)
      .join(' · ') || undefined

  const loadOptions = async (q: string, signal: AbortSignal): Promise<ComboboxOption[]> => {
    const rows = await lookupsApi.accounts(q, { postableOnly }, signal)
    for (const r of rows) seen.current.set(r.id, r)
    return rows.map((r) => ({ value: r.id, label: accountLabel(r), description: describe(r) }))
  }

  return (
    <AsyncCombobox
      {...props}
      value={value || null}
      scopeKey={postableOnly ? 'postable' : 'all'}
      initialOption={account ? { value: account.id, label: accountLabel(account) } : null}
      loadOptions={loadOptions}
      onChange={(id) =>
        onChange(
          id ?? '',
          id ? (seen.current.get(id) ?? (account?.id === id ? account : null)) : null,
        )
      }
    />
  )
}

interface RefPickerProps extends PassThrough {
  resource: 'parties' | 'cost-centers' | 'projects'
  value: string
  onChange: (id: string, record: NamedRef | null) => void
  record?: NamedRef | null
}

/** Party, cost center or project search (code + name) for line dimensions and filters. */
export function RefPicker({ resource, value, onChange, record, ...props }: RefPickerProps) {
  const seen = useRef(new Map<string, NamedRef>())
  const loadOptions = async (q: string, signal: AbortSignal): Promise<ComboboxOption[]> => {
    const rows = await lookupsApi.refs(resource, q, signal)
    for (const r of rows) seen.current.set(r.id, r)
    return rows.map((r) => ({ value: r.id, label: refLabel(r) }))
  }
  return (
    <AsyncCombobox
      {...props}
      value={value || null}
      scopeKey={resource}
      initialOption={record ? { value: record.id, label: refLabel(record) } : null}
      loadOptions={loadOptions}
      onChange={(id) =>
        onChange(
          id ?? '',
          id ? (seen.current.get(id) ?? (record?.id === id ? record : null)) : null,
        )
      }
    />
  )
}
