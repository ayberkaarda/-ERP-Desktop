import type { PartyType } from '../types'
import { isValidTckn } from './tckn'
import { isValidVkn } from './vkn'

export type TaxNumberKind = 'vkn' | 'tckn' | 'foreign'

/** TR companies use VKN, TR persons TCKN; other countries any identifier. */
export function taxNumberKind(country: string, type: PartyType): TaxNumberKind {
  if (country.toUpperCase() !== 'TR') return 'foreign'
  return type === 'person' ? 'tckn' : 'vkn'
}

export type TaxNumberProblem =
  'vknLength' | 'vknChecksum' | 'tcknLength' | 'tcknChecksum' | 'foreign'

export const FOREIGN_TAX_NUMBER_MAX = 32

/** Null when acceptable; empty is acceptable since the field is optional. */
export function taxNumberProblem(
  value: string,
  country: string,
  type: PartyType,
): TaxNumberProblem | null {
  const kind = taxNumberKind(country, type)
  const v = normalizeTaxNumber(value, country)
  if (v === '') return null
  if (kind === 'vkn') {
    if (!/^\d{10}$/.test(v)) return 'vknLength'
    return isValidVkn(v) ? null : 'vknChecksum'
  }
  if (kind === 'tckn') {
    if (!/^\d{11}$/.test(v)) return 'tcknLength'
    return isValidTckn(v) ? null : 'tcknChecksum'
  }
  // Same charset as the server: any letter or digit (also non-ASCII), dash, slash, dot, space.
  return v.length <= FOREIGN_TAX_NUMBER_MAX && /^[\p{L}\p{N}.\-/ ]+$/u.test(v) ? null : 'foreign'
}

/** Mirrors the server: Turkish numbers lose spaces, dots and dashes; foreign ones are trimmed. */
export function normalizeTaxNumber(value: string, country: string): string {
  const v = value.trim()
  return country.toUpperCase() === 'TR' ? v.replace(/[\s.-]+/g, '') : v
}
