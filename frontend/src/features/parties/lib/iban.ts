// Client copy of the server rule; the API stays authoritative.
import { ibanLayout } from './ibanRegistry'

/** Uppercase without spaces, as stored by the API. */
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

/** Groups of four for display. */
export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})(?=.)/g, '$1 ')
}

/** ISO 7064 mod 97-10 of the rearranged IBAN, digit by digit to stay in int range. */
export function ibanMod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0)
    const part = code >= 65 && code <= 90 ? String(code - 55) : ch
    for (const digit of part) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder
}

export type IbanProblem = 'format' | 'country' | 'length' | 'bban' | 'trFormat' | 'checksum'

/** Null when valid, else the first rule broken (registry country, length, BBAN, checksum). */
export function ibanProblem(value: string): IbanProblem | null {
  const iban = normalizeIban(value)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return 'format'
  const country = iban.slice(0, 2)
  const layout = ibanLayout(country)
  if (!layout) return 'country'
  if (iban.length !== layout.length) return 'length'
  if (!layout.bban.test(iban.slice(4))) return 'bban'
  // TR: the digit after the 5-digit bank code is reserved and always 0.
  if (country === 'TR' && iban[9] !== '0') return 'trFormat'
  return ibanMod97(iban) === 1 ? null : 'checksum'
}

export function isValidIban(value: string): boolean {
  return ibanProblem(value) === null
}
