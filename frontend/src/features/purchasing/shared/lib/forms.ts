import Decimal from 'decimal.js'
import type { Item } from '@/features/catalog'
import { CANONICAL, dec, trimDecimal } from '@/features/sales/shared/lib/lines'
import type { LineLabels } from '../types'

export {
  addCalendarDays,
  baseQuantity,
  dec,
  factorOf,
  isDecimal,
  newLineKey,
  trimDecimal,
} from '@/features/sales/shared/lib/lines'
export { CANONICAL }

/** The item a line refers to, as much as the editors need of it. */
export interface PurchLineItem {
  id: string
  code: string
  name: string
  type: 'stock' | 'service'
  base_unit_id: string
  base_unit_code?: string | null
  /** Purchase tax first (Catalog purchase_tax_code_id), else the item default. */
  tax_code_id?: string | null
}

export function toPurchLineItem(item: Item): PurchLineItem {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    type: item.type,
    base_unit_id: item.base_unit_id,
    base_unit_code: item.base_unit?.code ?? null,
    tax_code_id: item.purchase_tax_code_id ?? item.default_tax_code_id,
  }
}

/** The line item of a stored line (labels from Catalog; empty when not readable). */
export function storedLineItem(
  l: LineLabels & { item_id: string; item_type: 'stock' | 'service' | null },
): PurchLineItem {
  return {
    id: l.item_id,
    code: l.item_code ?? '',
    name: l.item_name ?? '',
    type: l.item_type ?? 'stock',
    base_unit_id: l.base_unit_id ?? '',
    base_unit_code: l.base_unit_code ?? null,
  }
}

export const orNull = (v: string) => (v.trim() === '' ? null : v.trim())
export const orZero = (v: string) => (v.trim() === '' ? '0' : v.trim())
/** "0.0000" and "" are both "nothing" in the form. */
export const optional = (v: string) => (dec(v).isZero() ? '' : trimDecimal(v))

/**
 * Whether a typed decimal breaks the API rules: canonical, no more than `scale` fraction digits,
 * not negative, positive when required, at most `max`; '' only when optional.
 */
export function decimalProblem(
  value: string,
  opts: { scale: number; positive?: boolean; max?: string; optional?: boolean },
): boolean {
  const v = value.trim()
  if (v === '') return !opts.optional
  if (!CANONICAL.test(v)) return true
  const d = new Decimal(v)
  if (d.decimalPlaces() > opts.scale) return true
  if (d.isNegative() && !d.isZero()) return true
  if (opts.positive && !d.gt(0)) return true
  return opts.max !== undefined && d.gt(opts.max)
}

/**
 * Maps API field paths to form paths. Body line indexes skip blank form lines, so
 * "lines.1.quantity" is the second non-blank line; unknown fields stay unmapped.
 */
export function fieldMapper<L>(
  lines: readonly L[],
  isBlank: (l: L) => boolean,
  header: Record<string, string>,
  lineFields: Record<string, string>,
) {
  const formIndex = lines.flatMap((l, i) => (isBlank(l) ? [] : [i]))
  return (field: string): string | null => {
    if (Object.hasOwn(header, field)) return header[field] ?? null
    const m = /^lines\.(\d+)\.([a-z_]+)$/.exec(field)
    if (!m) return null
    const index = formIndex[Number(m[1])]
    const key = m[2] ?? ''
    const name = Object.hasOwn(lineFields, key) ? lineFields[key] : undefined
    return index === undefined || !name ? null : `lines.${index}.${name}`
  }
}

/** Display of a decimal string without trailing zeros ("10.500000" -> "10.5"); bad input as is. */
export const plain = (v: string | null | undefined): string =>
  typeof v !== 'string' ? '' : CANONICAL.test(v.trim()) ? trimDecimal(v) : v

/** Label of a line item for summaries ("CVT-01 · Cıvata M8"), else its description. */
export const lineName = (l: {
  item_code?: string | null
  item_name?: string | null
  description?: string | null
}): string => {
  const name = [l.item_code, l.item_name].filter(Boolean).join(' · ')
  return name !== '' ? name : l.description?.trim() ? l.description : '—'
}
