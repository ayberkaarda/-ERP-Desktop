import { Check, ChevronDown, Loader2, X } from 'lucide-react'
import { useId, useRef, useState, type ComponentProps, type KeyboardEvent, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useIntlLocale } from '@/lib/datetime/locale'
import { cn } from '@/lib/utils'

export interface ComboboxOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

type NativeProps = Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'defaultValue' | 'type' | 'role' | 'ref'
>

export interface ComboboxProps extends NativeProps {
  value: string | null
  onChange: (value: string | null, option: ComboboxOption | null) => void
  options: ComboboxOption[]
  /** Shown when `value` is not among `options` (async lists, edit forms). */
  selectedOption?: ComboboxOption | null
  clearable?: boolean
  /** Client-side filter; pass `false` when the options are already server-filtered. */
  filter?: ((option: ComboboxOption, query: string) => boolean) | false
  onQueryChange?: (query: string) => void
  onOpenChange?: (open: boolean) => void
  loading?: boolean
  /** Text shown in the list when there is nothing to pick. */
  emptyText?: string
  ref?: Ref<HTMLInputElement>
}

/**
 * WAI-ARIA combobox with a listbox popup. Focus never leaves the input: arrows move the
 * highlight, Enter or Tab (after typing) picks, Escape closes.
 */
export function Combobox({
  value,
  onChange,
  options,
  selectedOption,
  clearable = false,
  filter,
  onQueryChange,
  onOpenChange,
  loading = false,
  emptyText,
  placeholder,
  disabled,
  className,
  onKeyDown,
  onBlur,
  ref,
  ...props
}: ComboboxProps) {
  const { t } = useTranslation('common')
  const locale = useIntlLocale()
  const listId = useId()
  const anchorRef = useRef<HTMLDivElement>(null)
  const [open, setOpenState] = useState(false)
  const [query, setQuery] = useState('')
  const [typed, setTyped] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const selected =
    options.find((o) => o.value === value) ??
    (selectedOption?.value === value ? selectedOption : null)

  const norm = (s: string) => s.toLocaleLowerCase(locale)
  const matches =
    filter === false || !typed || query === ''
      ? options
      : options.filter((o) =>
          filter
            ? filter(o, query)
            : norm(o.label).includes(norm(query)) ||
              (o.description ? norm(o.description).includes(norm(query)) : false),
        )
  const current = Math.min(highlight, Math.max(matches.length - 1, 0))
  const optionId = (i: number) => `${listId}-o${i}`

  const setOpen = (next: boolean) => {
    if (next === open) return
    setOpenState(next)
    onOpenChange?.(next)
    if (!next) {
      setTyped(false)
      setQuery('')
    }
  }

  const pick = (option: ComboboxOption | undefined) => {
    if (!option || option.disabled) return
    onChange(option.value, option)
    setOpen(false)
  }

  const move = (delta: number) => {
    if (!open) {
      setOpen(true)
      const idx = matches.findIndex((o) => o.value === value)
      setHighlight(idx >= 0 ? idx : 0)
      return
    }
    if (matches.length === 0) return
    const n = matches.length
    // Walk in `delta` direction, skipping disabled options; wraps around the list.
    const next =
      matches
        .map((_, step) => (((current + delta * (step + 1)) % n) + n) % n)
        .find((i) => !matches[i]?.disabled) ?? current
    setHighlight(next)
    document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'Enter':
        if (open) {
          e.preventDefault()
          pick(matches[current])
        }
        break
      case 'Tab':
        // Typing then tabbing away is the fast path in line editors: take the highlighted match.
        if (open && typed && query !== '') pick(matches[current])
        else setOpen(false)
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
        }
        break
      default:
    }
  }

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className={cn('relative', className)}>
          <Input
            {...props}
            ref={ref}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && matches[current] ? optionId(current) : undefined}
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder ?? t('combobox.placeholder')}
            value={open && typed ? query : (selected?.label ?? '')}
            onChange={(e) => {
              setQuery(e.target.value)
              setTyped(true)
              setHighlight(0)
              onQueryChange?.(e.target.value)
              if (!open) {
                setOpenState(true)
                onOpenChange?.(true)
              }
            }}
            onKeyDown={handleKeyDown}
            onBlur={(e) => {
              if (!anchorRef.current?.contains(e.relatedTarget)) setOpen(false)
              onBlur?.(e)
            }}
            className={cn(clearable && selected ? 'pr-14' : 'pr-8')}
          />
          <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
            {clearable && selected && !disabled && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={t('combobox.clear')}
                className="rounded-xs p-1 text-muted-foreground hover:text-foreground"
                onClick={() => onChange(null, null)}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              tabIndex={-1}
              aria-label={t('combobox.toggle')}
              disabled={disabled}
              className="rounded-xs p-1 text-muted-foreground hover:text-foreground"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (open) setOpen(false)
                else move(0)
                anchorRef.current?.querySelector('input')?.focus()
              }}
            >
              <ChevronDown className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        role="presentation"
        className="max-h-72 w-(--radix-popover-trigger-width) min-w-56 overflow-auto p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault()
        }}
      >
        <ul id={listId} role="listbox" aria-label={props['aria-label']}>
          {matches.map((option, i) => (
            <li
              key={option.value}
              id={optionId(i)}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled ? true : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setHighlight(i)}
              onClick={() => pick(option)}
              className={cn(
                'relative flex cursor-default flex-col rounded-sm py-1.5 pr-8 pl-2 text-sm select-none',
                i === current && 'bg-surface-sunken',
                option.disabled && 'opacity-50',
              )}
            >
              <span className="truncate">{option.label}</span>
              {option.description && (
                <span className="truncate text-xs text-muted-foreground">{option.description}</span>
              )}
              {option.value === value && (
                <Check className="absolute top-2 right-2 size-4 text-primary" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
        {matches.length === 0 && (
          <p
            className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground"
            role="status"
          >
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {loading ? t('combobox.searching') : (emptyText ?? t('combobox.noResults'))}
          </p>
        )}
        {matches.length > 0 && loading && (
          <p className="sr-only" role="status">
            {t('combobox.searching')}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
