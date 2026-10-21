import type { Attributes } from '../types'

export interface AttributeRow {
  key: string
  value: string
}

export function toAttributeRows(attributes: Attributes | null | undefined): AttributeRow[] {
  return Object.entries(attributes ?? {}).map(([key, value]) => ({ key, value }))
}

/** Rows with an empty key are dropped; keys and values are trimmed. */
export function fromAttributeRows(rows: readonly AttributeRow[]): Attributes {
  const out: [string, string][] = []
  for (const r of rows) {
    const key = r.key.trim()
    if (key) out.push([key, r.value.trim()])
  }
  return Object.fromEntries(out)
}

/** "renk: kırmızı, beden: M" for tables. */
export function formatAttributes(attributes: Attributes | null | undefined): string {
  return Object.entries(attributes ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
}
