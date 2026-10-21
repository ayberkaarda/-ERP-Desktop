// Client copy of the server rule; the API stays authoritative.

/** Fixed lengths for common countries; others are only checked against 15..34. */
const LENGTHS: Readonly<Record<string, number>> = {
  AT: 20,
  BE: 16,
  BG: 22,
  CH: 21,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  ES: 24,
  FI: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GR: 27,
  HU: 28,
  IE: 22,
  IT: 27,
  LU: 20,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  RO: 24,
  SE: 24,
  TR: 26,
  UA: 29,
}

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

export type IbanProblem = 'format' | 'length' | 'trFormat' | 'checksum'

/** Null when valid, else the first rule broken. */
export function ibanProblem(value: string): IbanProblem | null {
  const iban = normalizeIban(value)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return 'format'
  const country = iban.slice(0, 2)
  const expected = LENGTHS[country]
  const lengthOk =
    expected !== undefined ? iban.length === expected : iban.length >= 15 && iban.length <= 34
  if (!lengthOk) return 'length'
  // TR layout: 5-digit bank code, reserved 0, 16-digit account.
  if (country === 'TR' && !/^TR\d{7}0\d{16}$/.test(iban)) return 'trFormat'
  return ibanMod97(iban) === 1 ? null : 'checksum'
}

export function isValidIban(value: string): boolean {
  return ibanProblem(value) === null
}
