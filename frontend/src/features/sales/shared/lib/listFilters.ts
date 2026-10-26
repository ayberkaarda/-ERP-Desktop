import type { ListQueryState } from '@/components/shared/data-table'

/** Filters every sales list understands (filter[...] names of the ListQuery). */
export const LIST_FILTERS = [
  'status',
  'party_id',
  'date_from',
  'date_to',
  'number',
  'item_id',
] as const
export const SAVED_KEYS = ['q', ...LIST_FILTERS] as const

/** Sorts the sales lists accept (anything else is a 422 from the API). */
export const LIST_SORTS = [
  'document_date',
  'number',
  'party_name',
  'total',
  'total_local',
  'status',
  'due_date',
  'created_at',
] as const

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Only allowlisted URL filters with well-formed values and allowlisted sorts reach the API; the
 * item filter only when its picker is available (items.view).
 */
export function sanitizeListQuery(query: ListQueryState, canPickItems: boolean): ListQueryState {
  const filters: Record<string, string> = {}
  for (const key of LIST_FILTERS) {
    const v = query.filters[key]
    if (!v) continue
    if ((key === 'date_from' || key === 'date_to') && !DATE.test(v)) continue
    if (key === 'item_id' && !canPickItems) continue
    filters[key] = v.slice(0, 100)
  }
  const sort = query.sort.filter((s) => (LIST_SORTS as readonly string[]).includes(s.id))
  return { ...query, filters, sort }
}
