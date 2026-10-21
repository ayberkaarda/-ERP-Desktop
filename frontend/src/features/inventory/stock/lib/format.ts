import Decimal from 'decimal.js'
import { useMemo } from 'react'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'

/** Quantities keep up to 6 decimals (numeric(20,6)) but show no needless trailing zeros. */
export function formatQuantity(value: string, locale: string): string {
  return formatDecimalDisplay(value, { locale, minFraction: 0, maxFraction: 6 })
}

/** Money (numeric(20,4) values, numeric(20,6) unit costs) shown with 2 to `max` decimals. */
export function formatAmount(value: string, locale: string, max = 2): string {
  return formatDecimalDisplay(value, { locale, minFraction: 2, maxFraction: max })
}

function dec(value: string): Decimal | null {
  try {
    return new Decimal(value)
  } catch {
    return null
  }
}

export function isNegative(value: string): boolean {
  const d = dec(value)
  return d !== null && d.isNegative() && !d.isZero()
}

/** Formatters bound to the UI locale; the object is stable while the locale stays the same. */
export function useFormatters() {
  const locale = useIntlLocale()
  return useMemo(
    () => ({
      locale,
      qty: (v: string) => formatQuantity(v, locale),
      money: (v: string) => formatAmount(v, locale),
      cost: (v: string) => formatAmount(v, locale, 6),
    }),
    [locale],
  )
}
