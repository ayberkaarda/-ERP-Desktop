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
  const v = value.trim()
  if (v === '') return null
  const kind = taxNumberKind(country, type)
  if (kind === 'vkn') {
    if (!/^\d{10}$/.test(v)) return 'vknLength'
    return isValidVkn(v) ? null : 'vknChecksum'
  }
  if (kind === 'tckn') {
    if (!/^\d{11}$/.test(v)) return 'tcknLength'
    return isValidTckn(v) ? null : 'tcknChecksum'
  }
  return v.length <= FOREIGN_TAX_NUMBER_MAX && /^[A-Za-z0-9.\-/ ]+$/.test(v) ? null : 'foreign'
}
