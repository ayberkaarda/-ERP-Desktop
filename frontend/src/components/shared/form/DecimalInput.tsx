import { useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { useIntlLocale } from '@/lib/datetime/locale'
import {
  decimalSeparator,
  formatDecimalDisplay,
  parseDecimalInput,
  toEditableText,
} from '@/lib/money/input'
import { cn } from '@/lib/utils'

const CANONICAL = /^-?\d+(?:\.\d+)?$/

type NativeProps = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'defaultValue'>

export interface DecimalInputProps extends NativeProps {
  /** Canonical decimal string ("1234.50") or ''. Invalid text is passed through for zod to flag. */
  value: string
  onChange: (value: string) => void
  scale: number
  /** Fraction digits shown when not editing (money 2; quantities may show fewer). */
  displayMinFraction?: number
  allowNegative?: boolean
  locale?: string
  suffix?: ReactNode
}

/** Decimal field that never goes through JS numbers: text in, canonical string out. */
export function DecimalInput({
  value,
  onChange,
  scale,
  displayMinFraction = scale,
  allowNegative = false,
  locale: localeProp,
  suffix,
  className,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: DecimalInputProps) {
  const uiLocale = useIntlLocale()
  const locale = localeProp ?? uiLocale
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const options = { scale, locale, allowNegative }

  const canonical = CANONICAL.test(value)
  const display = canonical
    ? formatDecimalDisplay(value, { locale, minFraction: displayMinFraction, maxFraction: scale })
    : value

  const emit = (next: string) => {
    setText(next)
    const parsed = parseDecimalInput(next, options)
    onChange(parsed.ok ? parsed.value : next)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    // Numpad "." types the locale's separator, as in desktop accounting tools.
    const sep = decimalSeparator(locale)
    if (e.code === 'NumpadDecimal' && e.key !== sep) {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart ?? text.length
      const end = el.selectionEnd ?? start
      emit(text.slice(0, start) + sep + text.slice(end))
      requestAnimationFrame(() => el.setSelectionRange(start + 1, start + 1))
    }
  }

  return (
    <div className="relative">
      <Input
        {...props}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={editing ? text : display}
        onFocus={(e) => {
          setText(canonical ? toEditableText(value, locale) : value)
          setEditing(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setEditing(false)
          onBlur?.(e)
        }}
        onChange={(e) => emit(e.target.value)}
        onKeyDown={handleKeyDown}
        className={cn('text-right tabular-nums', suffix ? 'pr-9' : undefined, className)}
      />
      {suffix && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground"
        >
          {suffix}
        </span>
      )}
    </div>
  )
}

function currencySymbol(currency: string, locale: string): string {
  return (
    new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency')?.value ?? currency
  )
}

export interface MoneyInputProps extends Omit<DecimalInputProps, 'scale' | 'suffix'> {
  currency?: string
  scale?: number
}

/** Amount in `currency`; 2 decimals by default (API stores numeric(20,4)). */
export function MoneyInput({ currency = 'TRY', scale = 2, ...props }: MoneyInputProps) {
  const uiLocale = useIntlLocale()
  return (
    <DecimalInput
      scale={scale}
      suffix={currencySymbol(currency, props.locale ?? uiLocale)}
      {...props}
    />
  )
}

export interface QuantityInputProps extends Omit<DecimalInputProps, 'scale'> {
  /** Up to 6 (numeric(20,6)). */
  scale?: number
  unit?: ReactNode
}

export function QuantityInput({
  scale = 3,
  unit,
  displayMinFraction = 0,
  ...props
}: QuantityInputProps) {
  return (
    <DecimalInput
      scale={Math.min(scale, 6)}
      displayMinFraction={displayMinFraction}
      suffix={unit}
      {...props}
    />
  )
}
