import type { ItemCategory } from '../types'

export interface CategoryNode {
  category: ItemCategory
  children: CategoryNode[]
  depth: number
  /** 1-based position among siblings and the sibling count (aria-posinset/aria-setsize). */
  pos: number
  size: number
}

const byCode = (a: ItemCategory, b: ItemCategory) =>
  a.code.localeCompare(b.code, 'tr', { numeric: true })

/** Builds the forest; rows whose parent is missing (or that sit in a cycle) become roots. */
export function buildTree(categories: readonly ItemCategory[]): CategoryNode[] {
  const ids = new Set(categories.map((c) => c.id))
  const children = new Map<string | null, ItemCategory[]>()
  for (const c of categories) {
    const parent = c.parent_id && ids.has(c.parent_id) ? c.parent_id : null
    const list = children.get(parent) ?? []
    list.push(c)
    children.set(parent, list)
  }
  const seen = new Set<string>()
  const build = (parent: string | null, depth: number): CategoryNode[] => {
    const list = (children.get(parent) ?? []).filter((c) => !seen.has(c.id)).sort(byCode)
    for (const c of list) seen.add(c.id)
    return list.map((c, i) => ({
      category: c,
      depth,
      pos: i + 1,
      size: list.length,
      children: build(c.id, depth + 1),
    }))
  }
  const roots = build(null, 0)
  // Rows only reachable through a cycle in bad data still appear, as roots.
  for (const c of [...categories].sort(byCode)) {
    if (!seen.has(c.id)) {
      seen.add(c.id)
      roots.push({ category: c, depth: 0, pos: 0, size: 0, children: build(c.id, 1) })
    }
  }
  roots.forEach((n, i) => {
    n.pos = i + 1
    n.size = roots.length
  })
  return roots
}

/** Depth-first order, optionally only through expanded nodes (what a tree view shows). */
export function flattenTree(
  nodes: readonly CategoryNode[],
  expanded?: ReadonlySet<string>,
): CategoryNode[] {
  const out: CategoryNode[] = []
  const walk = (list: readonly CategoryNode[]) => {
    for (const n of list) {
      out.push(n)
      if (!expanded || expanded.has(n.category.id)) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** All ids below `id` (not including it). */
export function descendantIds(id: string, categories: readonly ItemCategory[]): Set<string> {
  const byParent = new Map<string, string[]>()
  for (const c of categories) {
    if (!c.parent_id) continue
    byParent.set(c.parent_id, [...(byParent.get(c.parent_id) ?? []), c.id])
  }
  const out = new Set<string>()
  const stack = [...(byParent.get(id) ?? [])]
  while (stack.length > 0) {
    const next = stack.pop()
    if (next === undefined || out.has(next) || next === id) continue
    out.add(next)
    stack.push(...(byParent.get(next) ?? []))
  }
  return out
}

export type ReparentProblem = 'self' | 'descendant' | 'same'

/** Why moving `id` under `parentId` is not allowed (it would create a cycle), or null. */
export function reparentProblem(
  id: string,
  parentId: string | null,
  categories: readonly ItemCategory[],
): ReparentProblem | null {
  const current = categories.find((c) => c.id === id)
  if ((current?.parent_id ?? null) === parentId) return 'same'
  if (parentId === null) return null
  if (parentId === id) return 'self'
  if (descendantIds(id, categories).has(parentId)) return 'descendant'
  return null
}

/** "Root / Child / Grandchild" labels for pickers. */
export function categoryPath(id: string, categories: readonly ItemCategory[]): string {
  const map = new Map(categories.map((c) => [c.id, c]))
  const parts: string[] = []
  const seen = new Set<string>()
  let cur = map.get(id)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    parts.unshift(cur.name)
    cur = cur.parent_id ? map.get(cur.parent_id) : undefined
  }
  return parts.join(' / ')
}
