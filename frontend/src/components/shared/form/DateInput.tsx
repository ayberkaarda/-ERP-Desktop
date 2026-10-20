import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import {
  addDays,
  addMonths,
  clampCalendarDate,
  inCalendarRange,
  INVALID_DATE,
  formatDate,
  isValidCalendarDate,
  monthMatrix,
  parseCalendarInput,
  splitCalendarDate,
  toIsoDate,
} from '@/lib/datetime'
import { useIntlLocale } from '@/lib/datetime/locale'
import { cn } from '@/lib/utils'

type NativeProps = Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'defaultValue' | 'min' | 'max'
>

export interface DateInputProps extends NativeProps {
  /**
   * Calendar date "YYYY-MM-DD", '' or INVALID_DATE while the typed text is not a date inside
   * [min, max]; the draft itself is never passed out.
   */
  value: string
  onChange: (value: string) => void
  locale?: string
  min?: string
  max?: string
}

/** Typed-first calendar date field ("21.10.2026", "211026", "21.10") with a picker. */
export function DateInput({
  value,
  onChange,
  locale: localeProp,
  min,
  max,
  className,
  disabled,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: DateInputProps) {
  const { t } = useTranslation('common')
  const uiLocale = useIntlLocale()
  const locale = localeProp ?? uiLocale
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [emitted, setEmitted] = useState(value)
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const valid = isValidCalendarDate(value)
  const invalid = value === INVALID_DATE
  if (value !== emitted) {
    // Outside change (reset, load): the draft follows it.
    setEmitted(value)
    if (!invalid) setText(valid ? formatDate(value, locale) : '')
  }
  const display = valid ? formatDate(value, locale) : invalid ? text : ''

  const emit = (next: string) => {
    setEmitted(next)
    onChange(next)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className={cn('relative', className)}>
          <Input
            {...props}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            value={editing ? text : display}
            aria-invalid={invalid || props['aria-invalid'] ? true : undefined}
            onFocus={(e) => {
              setText(display)
              setEditing(true)
              onFocus?.(e)
            }}
            onBlur={(e) => {
              setEditing(false)
              onBlur?.(e)
            }}
            onChange={(e) => {
              setText(e.target.value)
              const parsed = parseCalendarInput(e.target.value, locale)
              emit(
                parsed === ''
                  ? ''
                  : parsed !== null && inCalendarRange(parsed, min, max)
                    ? parsed
                    : INVALID_DATE,
              )
            }}
            onKeyDown={handleKeyDown}
            className="pr-9"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            tabIndex={-1}
            disabled={disabled}
            aria-label={t('date.openCalendar')}
            aria-expanded={open}
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={() => setOpen((o) => !o)}
          >
            <CalendarDays aria-hidden="true" />
          </Button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="p-3"
        aria-label={t('date.calendar')}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          anchorRef.current?.querySelector('input')?.focus()
        }}
      >
        <CalendarGrid
          value={valid ? value : null}
          locale={locale}
          min={min}
          max={max}
          onSelect={(date) => {
            setText(formatDate(date, locale))
            emit(date)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

interface CalendarGridProps {
  value: string | null
  locale: string
  min?: string
  max?: string
  onSelect: (date: string) => void
}

function CalendarGrid({ value, locale, min, max, onSelect }: CalendarGridProps) {
  const { t } = useTranslation('common')
  const today = toIsoDate(new Date())
  // Start on the value, else today; either one is pulled into range so focus lands on an enabled day.
  const [focused, setFocusedRaw] = useState(() => clampCalendarDate(value ?? today, min, max))
  const setFocused = (d: string) => setFocusedRaw(clampCalendarDate(d, min, max))
  const { year, month } = splitCalendarDate(focused)
  const gridRef = useRef<HTMLTableElement>(null)
  const weekStartsOn = locale === 'en-US' ? 0 : 1
  const weeks = monthMatrix(year, month, weekStartsOn)
  // 2024-01-01 was a Monday; seven consecutive days give the locale's weekday names.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 1 + ((i + weekStartsOn + 6) % 7))),
    ),
  )
  const title = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
  const outOfRange = (d: string) => !inCalendarRange(d, min, max)

  useEffect(() => {
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus()
  }, [focused])

  const shiftMonth = (delta: number) => {
    const next = addMonths(year, month, delta)
    const { day } = splitCalendarDate(focused)
    const last = new Date(Date.UTC(next.year, next.month, 0)).getUTCDate()
    setFocused(
      `${next.year}-${String(next.month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`,
    )
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const moves: Record<string, () => void> = {
      ArrowLeft: () => setFocused(addDays(focused, -1)),
      ArrowRight: () => setFocused(addDays(focused, 1)),
      ArrowUp: () => setFocused(addDays(focused, -7)),
      ArrowDown: () => setFocused(addDays(focused, 7)),
      PageUp: () => shiftMonth(-1),
      PageDown: () => shiftMonth(1),
    }
    const move = moves[e.key]
    if (move) {
      e.preventDefault()
      move()
    }
  }

  return (
    <div className="w-64 space-y-2">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('date.prevMonth')}
          onClick={() => shiftMonth(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <p className="text-sm font-medium capitalize" aria-live="polite">
          {title}
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('date.nextMonth')}
          onClick={() => shiftMonth(1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <table
        ref={gridRef}
        role="grid"
        aria-label={title}
        className="w-full text-center text-xs"
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            {weekdays.map((d) => (
              <th key={d} scope="col" className="pb-1 font-medium text-muted-foreground">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((date, di) =>
                date ? (
                  <td key={date} className="p-0.5">
                    <button
                      type="button"
                      data-date={date}
                      tabIndex={date === focused ? 0 : -1}
                      disabled={outOfRange(date)}
                      aria-pressed={date === value}
                      aria-current={date === today ? 'date' : undefined}
                      aria-label={formatDate(date, locale)}
                      onClick={() => onSelect(date)}
                      className={cn(
                        'size-8 rounded-sm text-sm hover:bg-surface-sunken disabled:opacity-40',
                        date === today && 'font-semibold text-primary',
                        date === value &&
                          'bg-primary text-primary-foreground hover:bg-primary-hover',
                      )}
                    >
                      {Number(date.slice(8))}
                    </button>
                  </td>
                ) : (
                  <td key={`pad-${wi}-${di}`} />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <Button
        variant="ghost"
        size="sm"
        className="w-full"
        disabled={outOfRange(today)}
        onClick={() => onSelect(today)}
      >
        {t('date.today')}
      </Button>
    </div>
  )
}
