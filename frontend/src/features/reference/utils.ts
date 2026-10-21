import { TAX_TYPES, type RateStatus, type TaxCode, type TaxType, type TreeRow } from './types'

// ---- Trees (cost centers, warehouse locations) ---------------------------------------------

export interface TreeNode<T extends TreeRow> {
  row: T
  depth: number
  children: TreeNode<T>[]
}

const byCode = (a: TreeRow, b: TreeRow) => a.code.localeCompare(b.code, 'en', { numeric: true })

/** Builds a forest from a flat list; rows whose parent is missing become roots. Cycle-safe. */
export function buildTree<T extends TreeRow>(rows: readonly T[]): TreeNode<T>[] {
  const ids = new Set(rows.map((r) => r.id))
  const childrenOf = new Map<string | null, T[]>()
  for (const row of rows) {
    const parent = row.parent_id !== null && ids.has(row.parent_id) ? row.parent_id : null
    const list = childrenOf.get(parent) ?? []
    list.push(row)
    childrenOf.set(parent, list)
  }
  const seen = new Set<string>()
  const make = (parent: string | null, depth: number): TreeNode<T>[] =>
    (childrenOf.get(parent) ?? [])
      .sort(byCode)
      .filter((row) => !seen.has(row.id))
      .map((row) => {
        seen.add(row.id)
        return { row, depth, children: make(row.id, depth + 1) }
      })
  return make(null, 0)
}

/** Depth-first order, with children of collapsed nodes left out. */
export function flattenTree<T extends TreeRow>(
  nodes: readonly TreeNode<T>[],
  collapsed: ReadonlySet<string> = new Set(),
): TreeNode<T>[] {
  const out: TreeNode<T>[] = []
  const walk = (list: readonly TreeNode<T>[]) => {
    for (const node of list) {
      out.push(node)
      if (!collapsed.has(node.row.id)) walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/** The id itself plus everything below it: none of these may become its parent. */
export function subtreeIds(rows: readonly TreeRow[], id: string): Set<string> {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const row of rows) {
      if (row.parent_id !== null && out.has(row.parent_id) && !out.has(row.id)) {
        out.add(row.id)
        grew = true
      }
    }
  }
  return out
}

// ---- Tax codes -----------------------------------------------------------------------------

export type TaxValidity = 'active' | 'upcoming' | 'expired' | 'inactive'

/** Effective-date aware status; `today` is a calendar date (YYYY-MM-DD). */
export function taxValidity(code: TaxCode, today: string): TaxValidity {
  if (!code.is_active) return 'inactive'
  if (code.effective_from && code.effective_from > today) return 'upcoming'
  if (code.effective_to && code.effective_to < today) return 'expired'
  return 'active'
}

/** "20 %" for rates, "5/10" for withholding fractions, null when the code has neither. */
export function taxRateLabel(code: TaxCode): string | null {
  if (code.numerator !== null && code.denominator !== null) {
    return `${code.numerator}/${code.denominator}`
  }
  if (code.rate !== null) return `${code.rate.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')} %`
  return null
}

/** Groups codes by type in the fixed display order; within a type by code, newest period first. */
export function groupByType(rows: readonly TaxCode[]): { type: TaxType; rows: TaxCode[] }[] {
  return TAX_TYPES.map((type) => ({
    type,
    rows: rows
      .filter((r) => r.type === type)
      .sort(
        (a, b) =>
          a.code.localeCompare(b.code, 'en', { numeric: true }) ||
          (b.effective_from ?? '').localeCompare(a.effective_from ?? ''),
      ),
  })).filter((g) => g.rows.length > 0)
}

/** Global rows (no company) are maintained by seeders and cannot be edited. */
export function isGlobalTaxCode(code: Pick<TaxCode, 'company_id'>): boolean {
  return code.company_id === null
}

// ---- Exchange rates ------------------------------------------------------------------------

/** Rates older than this many days raise the staleness warning (PHASE2: stale after 4 days). */
export const STALE_AFTER_DAYS = 4

export function isRateStale(status: RateStatus | undefined): boolean {
  if (!status) return false
  if (status.last_fetch_date === null) return true
  if (typeof status.is_stale === 'boolean') return status.is_stale
  return status.stale_days !== null && status.stale_days > STALE_AFTER_DAYS
}
