import type { ListQueryState } from '@/components/shared/data-table'
import type { PurchaseKind } from '../types'

/** filter[...] keys the list pages offer (all lists accept these; PurchasingController). */
export const LIST_FILTERS = [
  'status',
  'supplier',
  'date_from',
  'date_to',
  'number',
  'item_id',
] as const
export const SAVED_KEYS = ['q', ...LIST_FILTERS] as const

/** Sorts each list accepts (anything else is a 422 from the API). */
export const LIST_SORTS: Record<PurchaseKind, readonly string[]> = {
  request: ['document_date', 'number', 'needed_by', 'estimated_total', 'status', 'created_at'],
  rfq: ['document_date', 'number', 'response_due', 'status', 'created_at'],
  order: [
    'document_date',
    'number',
    'party_name',
    'total',
    'total_local',
    'status',
    'due_date',
    'created_at',
  ],
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Only allowlisted URL filters with well-formed values and the list's sorts reach the API; the
 * item and supplier filters only when their pickers are usable (items.view, parties.view).
 */
export function sanitizeListQuery(
  kind: PurchaseKind,
  query: ListQueryState,
  can: { items: boolean; parties: boolean },
): ListQueryState {
  const filters: Record<string, string> = {}
  for (const key of LIST_FILTERS) {
    const v = query.filters[key]
    if (!v) continue
    if ((key === 'date_from' || key === 'date_to') && !DATE.test(v)) continue
    if (key === 'item_id' && !can.items) continue
    if (key === 'supplier' && !can.parties) continue
    filters[key] = v.slice(0, key === 'number' ? 64 : 100)
  }
  const sort = query.sort.filter((s) => LIST_SORTS[kind].includes(s.id))
  return { ...query, filters, sort }
}
