import type { WarehouseLocation } from '../../stock/lib/types'

export interface LocationNode {
  location: WarehouseLocation
  depth: number
  children: LocationNode[]
}

const SEPARATORS = ['-', '.', '/']

const byCode = (a: WarehouseLocation, b: WarehouseLocation) =>
  a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' })

/**
 * Parent of each location. The PHASE4 schema stores locations flat (warehouse, code, name), so
 * the hierarchy comes from bin codes: "A-01-03" sits under "A-01", which sits under "A" (any of
 * "-", "." or "/" separates levels; a missing level is skipped). If the API ever sends
 * `parent_id`, that wins.
 */
export function parentOf(locations: readonly WarehouseLocation[]): Map<string, string | null> {
  const out = new Map<string, string | null>()
  const ids = new Set(locations.map((l) => l.id))
  const explicit = locations.some((l) => l.parent_id !== undefined)
  if (explicit) {
    for (const l of locations) {
      const parent = l.parent_id ?? null
      out.set(l.id, parent !== null && ids.has(parent) && parent !== l.id ? parent : null)
    }
    return out
  }
  const byUpperCode = new Map(locations.map((l) => [l.code.toUpperCase(), l]))
  for (const l of locations) {
    const code = l.code.toUpperCase()
    let parent: string | null = null
    for (let i = code.length - 1; i > 0; i -= 1) {
      if (!SEPARATORS.includes(code.charAt(i))) continue
      const candidate = byUpperCode.get(code.slice(0, i))
      if (candidate && candidate.id !== l.id) {
        parent = candidate.id
        break
      }
    }
    out.set(l.id, parent)
  }
  return out
}

/** Nested nodes sorted by code; cycles in explicit parents are broken at the root. */
export function buildLocationTree(locations: readonly WarehouseLocation[]): LocationNode[] {
  const parents = parentOf(locations)
  const children = new Map<string | null, WarehouseLocation[]>()
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
