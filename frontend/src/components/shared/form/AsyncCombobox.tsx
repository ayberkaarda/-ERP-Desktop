import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { Combobox, type ComboboxOption, type ComboboxProps } from './Combobox'

export interface AsyncComboboxProps extends Omit<
  ComboboxProps,
  'options' | 'filter' | 'loading' | 'onQueryChange' | 'onOpenChange'
> {
  /** Fetches options for the typed text; the signal aborts superseded requests. */
  loadOptions: (query: string, signal: AbortSignal) => Promise<ComboboxOption[]>
  /** Label for the current value before any search ran (edit forms). */
  initialOption?: ComboboxOption | null
  minQueryLength?: number
  debounceMs?: number
  /**
   * Identity of whatever else the loader depends on (a role filter, a parent id). A change re-runs
   * the search for the same text and drops results loaded under the old scope.
   */
  scopeKey?: string
}

interface Result {
  key: string
  options: ComboboxOption[]
  failed: boolean
}

/** Server-backed combobox: the caller passes a loader, so the component has no network import. */
export function AsyncCombobox({
  loadOptions,
  initialOption = null,
  minQueryLength = 0,
  debounceMs = 250,
  scopeKey = '',
  onChange,
  emptyText,
  ...props
}: AsyncComboboxProps) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<Result>({ key: '', options: [], failed: false })
  const [picked, setPicked] = useState<ComboboxOption | null>(initialOption)
  const debounced = useDebouncedValue(query, debounceMs)
  const ready = open && debounced.length >= minQueryLength
  const key = ready ? JSON.stringify([scopeKey, debounced]) : ''

  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    loadOptions(debounced, controller.signal).then(
      (options) => {
        if (!controller.signal.aborted) setResult({ key, options, failed: false })
      },
      () => {
        if (!controller.signal.aborted) setResult({ key, options: [], failed: true })
      },
    )
    return () => controller.abort()
    // The loader is usually an inline closure; re-running on its identity would refetch per render.
    // `key` covers the text and the scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key])

  const fresh = result.key === key
  // Results for an older text are never pickable: Enter/Tab while typing must not select them.
  const current = fresh && query === debounced
  const loading = ready && !current
  const selectedOption =
    picked?.value === props.value
      ? picked
      : initialOption?.value === props.value
        ? initialOption
        : null

  let empty = emptyText
  if (!ready) empty = t('combobox.typeToSearch')
  else if (current && result.failed) empty = t('combobox.loadFailed')

  return (
    <Combobox
      {...props}
      options={current ? result.options : []}
      selectedOption={selectedOption}
      filter={false}
      loading={loading}
      emptyText={empty}
      onQueryChange={setQuery}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
      onChange={(value, option) => {
        setPicked(option)
        onChange(value, option)
      }}
    />
  )
}
