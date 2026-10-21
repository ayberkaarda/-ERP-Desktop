import { amountOf } from '../../journal/lib/balance'
import type { TrialBalanceAmounts, TrialBalanceRow } from '../types'

export interface TrialTreeRow {
  row: TrialBalanceRow
  depth: number
  hasChildren: boolean
  parentId: string | null
}

const byCode = (a: TrialBalanceRow, b: TrialBalanceRow) =>
  a.code < b.code ? -1 : a.code > b.code ? 1 : 0

/**
 * Orders mizan rows as a tree: parent_id when the parent is in the result, otherwise the
 * closest shorter code that prefixes this one ("120" for "120.01.001"). Rows whose parent is
 * missing (filtered by level or zero balances) become roots.
 */
export function buildTrialTree(rows: readonly TrialBalanceRow[]): TrialTreeRow[] {
  const sorted = [...rows].sort(byCode)
  const ids = new Set(sorted.map((r) => r.account_id))
  const parentOf = new Map<string, string | null>()
  for (const r of sorted) {
    let parent: string | null = r.parent_id && ids.has(r.parent_id) ? r.parent_id : null
    if (!parent) {
      let best: TrialBalanceRow | null = null
      for (const c of sorted) {
        if (c === r || c.code.length >= r.code.length || !r.code.startsWith(c.code)) continue
        if (!best || c.code.length > best.code.length) best = c
      }
      parent = best?.account_id ?? null
    }
    parentOf.set(r.account_id, parent)
  }
  const children = new Map<string | null, TrialBalanceRow[]>()
  for (const r of sorted) {
    const p = parentOf.get(r.account_id) ?? null
    children.set(p, [...(children.get(p) ?? []), r])
  }
  const out: TrialTreeRow[] = []
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const r of children.get(parent) ?? []) {
      if (seen.has(r.account_id)) continue
      seen.add(r.account_id)
      const kids = children.get(r.account_id) ?? []
      out.push({ row: r, depth, hasChildren: kids.length > 0, parentId: parent })
      walk(r.account_id, depth + 1, seen)
    }
  }
  walk(null, 0, new Set())
  return out
}

/** Rows shown when the ids in `collapsed` hide their descendants. */
export function visibleTrialRows(
  tree: readonly TrialTreeRow[],
  collapsed: ReadonlySet<string>,
): TrialTreeRow[] {
  const hidden = new Set<string>()
  return tree.filter((n) => {
    if (n.parentId && (hidden.has(n.parentId) || collapsed.has(n.parentId))) {
      hidden.add(n.row.account_id)
      return false
    }
    return true
  })
}

export interface TotalsCheck {
  movementsBalanced: boolean
  balancesBalanced: boolean
  movementDifference: string
  balanceDifference: string
}

/** The mizan's control: total debit = total credit for movements and for balances. */
export function checkTotals(totals: TrialBalanceAmounts): TotalsCheck {
  const movement = amountOf(totals.debit).minus(amountOf(totals.credit))
  const balance = amountOf(totals.balance_debit).minus(amountOf(totals.balance_credit))
  return {
    movementsBalanced: movement.isZero(),
    balancesBalanced: balance.isZero(),
    movementDifference: movement.abs().toFixed(2),
    balanceDifference: balance.abs().toFixed(2),
  }
}
