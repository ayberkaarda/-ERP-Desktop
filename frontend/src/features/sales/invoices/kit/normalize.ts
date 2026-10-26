import type { AuditEntry } from '@/components/shared/AuditTrail'
import { fetchAll, http, toAudit } from './http'
import type {
  ApiDetailExtras,
  ApiHeader,
  ApiLink,
  ApiLinks,
  DocLink,
  LinkType,
  Paginated,
  PartySnapshot,
} from './types'

type HeaderLike = Omit<ApiHeader, 'status'> & { status: string } & ApiDetailExtras

/** The party fields the API sends flat, as one snapshot object. */
export function snapshotOf(h: Omit<ApiHeader, 'status'>): PartySnapshot {
  return {
    name: h.party_name ?? '',
    tax_office: h.party_tax_office,
    tax_number: h.party_tax_number,
    billing_address: h.billing_address,
  }
}

/** Relations of DocumentLinks that point back in the chain (the rest point forward). */
const SOURCE_RELATIONS = new Set([
  'quote',
  'order',
  'deliveries:sales_invoice',
  'invoice:sales_delivery',
  'invoice:sales_return',
  'original_invoice',
  'return:sales_invoice',
  'previous_revision',
])

function relationOf(key: string, owner: string): 'source' | 'target' {
  return SOURCE_RELATIONS.has(key) || SOURCE_RELATIONS.has(`${key}:${owner}`) ? 'source' : 'target'
}

function toLink(l: ApiLink, relation: 'source' | 'target'): DocLink {
  const credit = l.document_type === 'sales_credit_note'
  return {
    type: (credit ? 'sales_invoice' : l.document_type) as LinkType,
    id: l.id,
    number: l.number,
    status: l.status,
    document_date: l.document_date,
    total: l.total,
    currency_code: l.currency_code,
    ...(credit ? { credit: true } : {}),
    relation,
  }
}

/** The named relations of a detail (`{order: {...}, invoices: [...]}`) as one ordered list. */
export function linksOf(links: ApiLinks | undefined, owner: string): DocLink[] {
  if (!links) return []
  const out: DocLink[] = []
  const seen = new Set<string>()
  for (const [key, value] of Object.entries(links)) {
    const rows = value === null ? [] : Array.isArray(value) ? value : [value]
    for (const row of rows) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      out.push(toLink(row, relationOf(key, owner)))
    }
  }
  return out.sort((a, b) => (a.relation === b.relation ? 0 : a.relation === 'source' ? -1 : 1))
}

/** First linked document of one relation, if any. */
export function linkNamed(links: ApiLinks | undefined, key: string): ApiLink | null {
  const value = links?.[key]
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/** Linked documents of one relation. */
export function linksNamed(links: ApiLinks | undefined, key: string): ApiLink[] {
  const value = links?.[key]
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export type Normalized<T extends HeaderLike> = Omit<T, 'links' | 'audit'> & {
  party_snapshot: PartySnapshot
  links: DocLink[]
  audit?: AuditEntry[]
}

/** Detail as the screens use it: party snapshot, chain list and audit entries. */
export function normalizeHeader<T extends HeaderLike>(raw: T): Normalized<T> {
  const { links, audit, ...rest } = raw
  return {
    ...rest,
    party_snapshot: snapshotOf(raw),
    links: linksOf(links, raw.document_type),
    audit: toAudit(raw.id, audit),
  }
}

// ---- Line labels (Catalog): the API sends item and unit ids only ----

export interface ItemRef {
  id: string
  code: string
  name: string
  type?: string
  tracking?: 'none' | 'lot' | 'serial'
  has_expiry?: boolean
  base_unit_id?: string | null
}

interface UnitRef {
  id: string
  code: string
  name?: string
}

const ITEM_ID_BATCH = 100

/** Items by id through the Catalog list's filter[id] (100 per request). */
export async function itemsByIds(
  ids: readonly (string | null | undefined)[],
  signal?: AbortSignal,
): Promise<Map<string, ItemRef>> {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))]
  const out = new Map<string, ItemRef>()
  const chunks: string[][] = []
  for (let i = 0; i < wanted.length; i += ITEM_ID_BATCH)
    chunks.push(wanted.slice(i, i + ITEM_ID_BATCH))
  const pages = await Promise.all(
    chunks.map((chunk) =>
      http()
        .get<Paginated<ItemRef>>('/items', {
          params: { 'filter[id]': chunk.join(','), per_page: ITEM_ID_BATCH },
          signal,
        })
        .then((r) => r.data),
    ),
  )
  for (const item of pages.flat()) if (wanted.includes(item.id)) out.set(item.id, item)
  return out
}

export interface LabelledLine {
  item_code: string | null
  item_name: string | null
  unit_code: string | null
  item_tracking: 'none' | 'lot' | 'serial'
  item_has_expiry: boolean
}

/**
 * Lines with the Catalog item code/name/tracking and the unit code. A lookup that fails (e.g. no
 * items.view) leaves the labels empty instead of failing the document.
 */
export async function labelLines<L extends { item_id: string | null; unit_id: string | null }>(
  lines: readonly L[],
  signal?: AbortSignal,
): Promise<(L & LabelledLine)[]> {
  if (lines.length === 0) return []
  const [items, units] = await Promise.all([
    itemsByIds(
      lines.map((l) => l.item_id),
      signal,
    ).catch(() => new Map<string, ItemRef>()),
    fetchAll<UnitRef>('/units', {}, signal).catch(() => [] as UnitRef[]),
  ])
  return lines.map((l) => {
    const item = l.item_id ? items.get(l.item_id) : undefined
    return {
      ...l,
      item_code: item?.code ?? null,
      item_name: item?.name ?? null,
      unit_code: units.find((u) => u.id === l.unit_id)?.code ?? null,
      item_tracking: item?.tracking ?? 'none',
      item_has_expiry: item?.has_expiry ?? false,
    }
  })
}
