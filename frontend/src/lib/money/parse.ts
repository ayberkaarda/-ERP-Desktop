import Decimal from 'decimal.js'

/** Parses user input in the given locale ("1.234,56" in tr-TR) into a Decimal; null when invalid. */
export function parseDecimal(input: string, locale = 'tr-TR'): Decimal | null {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
  const group = parts.find((p) => p.type === 'group')?.value ?? ','
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.'
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Locales like tr-TR group with a space-like char; accept any whitespace as that separator.
  const g = /\s/.test(group) ? '\\s' : esc(group)
  const d = esc(decimal)
  // Either ungrouped digits or correctly grouped thousands; "1.2.3,45" is rejected, not coerced.
  const shape = new RegExp(`^-?(?:\\d+|\\d{1,3}(?:${g}\\d{3})+)(?:${d}\\d+)?$`)
  const trimmed = input.trim()
  if (!shape.test(trimmed)) return null
  const [intPart = '', fracPart] = trimmed.split(decimal)
  const normalized = intPart.replace(new RegExp(g, 'g'), '') + (fracPart ? `.${fracPart}` : '')
  return new Decimal(normalized)
}
