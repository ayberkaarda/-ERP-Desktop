import type { WarehouseLocationRef } from '../../shared/warehouses'

export interface LocationNode {
  location: WarehouseLocationRef
  depth: number
  children: LocationNode[]
}

const byCode = (a: WarehouseLocationRef, b: WarehouseLocationRef) =>
  a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' })

/**
 * Parent of each location from Reference's parent_id (aisle > rack > shelf > bin). A parent that
 * is not in the list, or the location itself, makes it a root.
 */
export function parentOf(locations: readonly WarehouseLocationRef[]): Map<string, string | null> {
  const ids = new Set(locations.map((l) => l.id))
  const out = new Map<string, string | null>()
  for (const l of locations) {
    const parent = l.parent_id
    out.set(l.id, parent !== null && ids.has(parent) && parent !== l.id ? parent : null)
  }
  return out
}

/** Nested nodes sorted by code; cycles in explicit parents are broken at the root. */
export function buildLocationTree(locations: readonly WarehouseLocationRef[]): LocationNode[] {
  const parents = parentOf(locations)
  const children = new Map<string | null, WarehouseLocationRef[]>()
  for (const l of locations) {
    const p = parents.get(l.id) ?? null
    const list = children.get(p) ?? []
    list.push(l)
    children.set(p, list)
  }
  const seen = new Set<string>()
  const build = (parent: string | null, depth: number): LocationNode[] =>
    (children.get(parent) ?? [])
      .slice()
      .sort(byCode)
      .filter((l) => !seen.has(l.id))
      .map((l) => {
        seen.add(l.id)
        return { location: l, depth, children: build(l.id, depth + 1) }
      })
  const roots = build(null, 0)
  // Locations caught in a parent cycle never hang under the root; show them at the top level.
  for (const l of locations.filter((x) => !seen.has(x.id)).sort(byCode)) {
    if (seen.has(l.id)) continue
    seen.add(l.id)
    roots.push({ location: l, depth: 0, children: build(l.id, 1) })
  }
  return roots
}

/** Depth-first list of the nodes whose ancestors are all expanded (rendering order). */
export function visibleNodes(
  nodes: readonly LocationNode[],
  expanded: ReadonlySet<string>,
): LocationNode[] {
  const out: LocationNode[] = []
  const walk = (list: readonly LocationNode[]) => {
    for (const node of list) {
      out.push(node)
      if (expanded.has(node.location.id)) walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/** Ids of every node that has children (expand all). */
export function branchIds(nodes: readonly LocationNode[]): string[] {
  const out: string[] = []
  const walk = (list: readonly LocationNode[]) => {
    for (const node of list) {
      if (node.children.length > 0) {
        out.push(node.location.id)
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return out
}
