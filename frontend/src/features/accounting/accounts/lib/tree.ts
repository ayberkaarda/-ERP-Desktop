import type { Account, AccountTreeRow, AccountType } from '../../shared/types'

export interface AccountNode {
  account: Account
  children: AccountNode[]
}

/** One visible line of the tree view (already flattened in display order). */
export interface VisibleRow {
  account: Account
  depth: number
  hasChildren: boolean
  expanded: boolean
  /** Position among its siblings (1-based) and their count, for aria-posinset/setsize. */
  posinset: number
  setsize: number
  parentId: string | null
  /** Shown only as the path to a match (filters/search), not a match itself. */
  context: boolean
}

export interface TreeFilter {
  q: string
  type?: AccountType | ''
  /** 'true' | 'false' | '' */
  postable?: string
  active?: string
}

const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' })
export const compareCodes = (a: string, b: string) => collator.compare(a, b)

/** Accepts nested (`children`) or flat (`parent_id`) tree responses; returns flat rows. */
export function normalizeTree(rows: readonly AccountTreeRow[]): Account[] {
  const out = new Map<string, Account>()
  const walk = (list: readonly AccountTreeRow[], parent: string | null) => {
    for (const row of list) {
      const { children, ...account } = row
      out.set(account.id, {
        ...account,
        parent_id: account.parent_id ?? parent,
      })
      if (children?.length) walk(children, account.id)
    }
  }
  walk(rows, null)
  return [...out.values()]
}

/** Builds the tree from flat rows; rows whose parent is missing become roots. */
export function buildTree(accounts: readonly Account[]): AccountNode[] {
  const nodes = new Map<string, AccountNode>()
  for (const a of accounts) nodes.set(a.id, { account: a, children: [] })
  const roots: AccountNode[] = []
  for (const node of nodes.values()) {
    const parent = node.account.parent_id ? nodes.get(node.account.parent_id) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }
  const sort = (list: AccountNode[]) => {
    list.sort((a, b) => compareCodes(a.account.code, b.account.code))
    for (const n of list) sort(n.children)
  }
  sort(roots)
  return roots
}

const norm = (s: string) => s.toLocaleLowerCase('tr')

/** Code prefix or name substring (Turkish case rules). */
export function matchesQuery(account: Account, q: string): boolean {
  const needle = norm(q.trim())
  if (!needle) return true
  return norm(account.code).startsWith(needle) || norm(account.name).includes(needle)
}

function matchesFilter(account: Account, filter: TreeFilter): boolean {
  if (filter.type && account.type !== filter.type) return false
  if (filter.postable && String(account.is_postable) !== filter.postable) return false
  if (filter.active && String(account.is_active) !== filter.active) return false
  return matchesQuery(account, filter.q)
}

export function isFiltering(filter: TreeFilter): boolean {
  return (
    filter.q.trim() !== '' ||
    Boolean(filter.type) ||
    Boolean(filter.postable) ||
    Boolean(filter.active)
  )
}

/**
 * Rows to show, in order. Without a filter every expanded branch is shown. With a filter only
 * matches and their ancestors (as context) are shown, all expanded, so a hit deep in the chart
 * is visible at once.
 */
export function visibleRows(
  roots: readonly AccountNode[],
  expanded: ReadonlySet<string>,
  filter: TreeFilter,
): VisibleRow[] {
  const filtering = isFiltering(filter)
  // Which nodes have a match in their subtree (only needed while filtering).
  const keep = new Map<string, boolean>()
  if (filtering) {
    const mark = (node: AccountNode): boolean => {
      let any = matchesFilter(node.account, filter)
      for (const c of node.children) any = mark(c) || any
      keep.set(node.account.id, any)
      return any
    }
    for (const r of roots) mark(r)
  }
  const out: VisibleRow[] = []
  const walk = (list: readonly AccountNode[], depth: number, parentId: string | null) => {
    const shown = filtering ? list.filter((n) => keep.get(n.account.id)) : list
    shown.forEach((node, i) => {
      const children = filtering
        ? node.children.filter((c) => keep.get(c.account.id))
        : node.children
      const open = filtering || expanded.has(node.account.id)
      out.push({
        account: node.account,
        depth,
        hasChildren: children.length > 0,
        expanded: children.length > 0 && open,
        posinset: i + 1,
        setsize: shown.length,
        parentId,
        context: filtering && !matchesFilter(node.account, filter),
      })
      if (open) walk(node.children, depth + 1, node.account.id)
    })
  }
  walk(roots, 1, null)
  return out
}

/** Ids of every node that has children (expand all). */
export function branchIds(roots: readonly AccountNode[]): string[] {
  const out: string[] = []
  const walk = (list: readonly AccountNode[]) => {
    for (const n of list) {
      if (n.children.length) {
        out.push(n.account.id)
        walk(n.children)
      }
    }
  }
  walk(roots)
  return out
}

/** The account and everything below it (a parent may not be one of them: cycle). */
export function subtreeIds(accounts: readonly Account[], rootId: string): Set<string> {
  const byParent = new Map<string, string[]>()
  for (const a of accounts) {
    if (!a.parent_id) continue
    const list = byParent.get(a.parent_id) ?? []
    list.push(a.id)
    byParent.set(a.parent_id, list)
  }
  const out = new Set<string>([rootId])
  const stack = [rootId]
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    for (const child of byParent.get(id) ?? []) {
      if (!out.has(child)) {
        out.add(child)
        stack.push(child)
      }
    }
  }
  return out
}

/** Ancestor chain from the root down to the account's parent. */
export function ancestors(byId: ReadonlyMap<string, Account>, account: Account): Account[] {
  const chain: Account[] = []
  const seen = new Set<string>([account.id])
  let cur = account.parent_id ? byId.get(account.parent_id) : undefined
  while (cur && !seen.has(cur.id)) {
    chain.unshift(cur)
    seen.add(cur.id)
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
  }
  return chain
}
