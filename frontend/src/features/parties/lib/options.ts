import type { ComboboxOption } from '@/components/shared/form'

const A = 65
const NOT_COUNTRIES = new Set([
  'EU',
  'EZ',
  'UN',
  'ZZ',
  'QO',
  'XA',
  'XB',
  'AC',
  'CP',
  'DG',
  'EA',
  'IC',
  'TA',
])
const countryCache = new Map<string, ComboboxOption[]>()

/** ISO 3166-1 alpha-2 regions the runtime can name, in the UI language's order. */
export function countryOptions(locale: string): ComboboxOption[] {
  const cached = countryCache.get(locale)
  if (cached) return cached
  const names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' })
  const out: ComboboxOption[] = []
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const code = String.fromCharCode(A + i, A + j)
      if (NOT_COUNTRIES.has(code)) continue
      let label: string | undefined
      try {
        label = names.of(code)
      } catch {
        label = undefined
      }
      if (label && label !== code) out.push({ value: code, label, description: code })
    }
  }
  out.sort((a, b) => a.label.localeCompare(b.label, locale))
  countryCache.set(locale, out)
  return out
}

export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

// Until the reference module's currency picker is wired in, offer the common ones.
const CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CNY', 'RUB', 'SAR', 'AED']

export function currencyOptions(locale: string, current?: string | null): ComboboxOption[] {
  const names = new Intl.DisplayNames([locale], { type: 'currency' })
  const codes = current && !CURRENCIES.includes(current) ? [...CURRENCIES, current] : CURRENCIES
  return codes.map((code) => ({ value: code, label: code, description: names.of(code) }))
}
