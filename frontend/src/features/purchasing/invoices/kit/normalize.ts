import type { AuditEntry } from '@/components/shared/AuditTrail'
import { toAudit } from '@/features/sales/invoices/kit/http'
import { labelLines } from '@/features/sales/invoices/kit/normalize'
import type {
  ApiDetailExtras,
  ApiHeader,
  ApiLink,
  ApiLinks,
  DocLink,
  LineLabels,
  LinkType,
  PartySnapshot,
} from './types'

export { labelLines }

type HeaderLike = Omit<ApiHeader, 'status'> & { status: string } & ApiDetailExtras

/** The supplier fields the API sends flat, as one snapshot object. */
export function snapshotOf(h: Omit<ApiHeader, 'status'>): PartySnapshot {
  return {
    name: h.party_name ?? '',
    tax_office: h.party_tax_office,
    tax_number: h.party_tax_number,
    billing_address: h.billing_address,
  }
}

/**
 * Relations of DocumentLinks that point back in the chain (request -> RFQ -> order -> receipt ->
 * invoice -> return -> debit note); the rest point forward. Keys are `<relation>` or
 * `<relation>:<owner document_type>` when the direction depends on the owner.
 */
const SOURCE_RELATIONS = new Set([
  'request',
  'rfq',
  'order',
  'receipts:purchase_invoice',
  'receipt:purchase_return',
  'invoice:purchase_return',
  'invoice:purchase_receipt',
  'original_invoice',
  'return:purchase_debit_note',
])

function relationOf(key: string, owner: string): 'source' | 'target' {
  return SOURCE_RELATIONS.has(key) || SOURCE_RELATIONS.has(`${key}:${owner}`) ? 'source' : 'target'
}

function toLink(l: ApiLink, relation: 'source' | 'target'): DocLink | null {
  if (l.document_type === 'unknown') return null
  return {
    type: l.document_type,
    id: l.id,
    number: l.number,
    status: l.status,
    document_date: l.document_date,
    total: l.total,
    currency_code: l.currency_code,
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
      const link = toLink(row, relationOf(key, owner))
      if (!link) continue
      seen.add(row.id)
      out.push(link)
    }
  }
  return out.sort((a, b) => (a.relation === b.relation ? 0 : a.relation === 'source' ? -1 : 1))
}

/** Linked documents of one relation (empty when hidden by permissions). */
export function linksNamed(links: ApiLinks | undefined, key: string): ApiLink[] {
  const value = links?.[key]
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function linkNamed(links: ApiLinks | undefined, key: string): ApiLink | null {
  return linksNamed(links, key)[0] ?? null
}

export type Normalized<T extends HeaderLike> = Omit<T, 'links' | 'audit'> & {
  party_snapshot: PartySnapshot
  links: DocLink[]
  raw_links: ApiLinks
  audit?: AuditEntry[]
}

/** Detail as the screens use it: supplier snapshot, chain list, the named links and audit. */
export function normalizeHeader<T extends HeaderLike>(raw: T): Normalized<T> {
  const { links, audit, ...rest } = raw
  return {
    ...rest,
    party_snapshot: snapshotOf(raw),
    links: linksOf(links, raw.document_type),
    raw_links: links ?? {},
    audit: toAudit(raw.id, audit),
  }
}

/** Lines sorted by line_no with Catalog labels (code, name, tracking, unit code). */
export async function labelSorted<L extends { line_no: number; item_id: string; unit_id: string }>(
  lines: readonly L[],
  signal?: AbortSignal,
): Promise<(L & LineLabels)[]> {
  return labelLines(
    [...lines].sort((a, b) => a.line_no - b.line_no),
    signal,
  )
}

export const isLinkType = (v: string): v is LinkType =>
  [
    'purchase_request',
    'purchase_rfq',
    'purchase_order',
    'purchase_receipt',
    'purchase_invoice',
    'purchase_debit_note',
    'purchase_return',
    'stock_document',
    'journal_entry',
  ].includes(v)
