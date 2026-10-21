import type { ItemCategory } from '../types'
import { buildTree, categoryPath, descendantIds, flattenTree, reparentProblem } from './tree'

const cat = (id: string, parent: string | null, code = id): ItemCategory => ({
  id,
  code,
  name: id.toUpperCase(),
  parent_id: parent,
  version: 1,
})

const data = [cat('a', null), cat('b', 'a'), cat('c', 'b'), cat('d', null), cat('e', 'missing')]

describe('category tree', () => {
  it('builds a sorted forest; orphans become roots', () => {
    const tree = buildTree(data)
    expect(tree.map((n) => n.category.id)).toEqual(['a', 'd', 'e'])
    expect(tree[0]?.children[0]?.children[0]?.category.id).toBe('c')
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2)
  })

  it('survives cycles in stored data', () => {
    const tree = buildTree([cat('x', 'y'), cat('y', 'x')])
    expect(
      flattenTree(tree)
        .map((n) => n.category.id)
        .sort(),
    ).toEqual(['x', 'y'])
  })

  it('flattens only through expanded nodes', () => {
    const tree = buildTree(data)
    expect(flattenTree(tree, new Set()).map((n) => n.category.id)).toEqual(['a', 'd', 'e'])
    expect(flattenTree(tree, new Set(['a'])).map((n) => n.category.id)).toEqual([
      'a',
      'b',
      'd',
      'e',
    ])
  })

  it('finds descendants', () => {
    expect([...descendantIds('a', data)].sort()).toEqual(['b', 'c'])
    expect(descendantIds('c', data).size).toBe(0)
  })

  it('prevents cycles when reparenting', () => {
    expect(reparentProblem('a', 'a', data)).toBe('self')
    expect(reparentProblem('a', 'c', data)).toBe('descendant')
    expect(reparentProblem('c', 'b', data)).toBe('same')
    expect(reparentProblem('c', 'd', data)).toBeNull()
    expect(reparentProblem('b', null, data)).toBeNull()
  })

  it('numbers siblings for aria-posinset/aria-setsize', () => {
    const tree = buildTree(data)
    expect(tree.map((n) => [n.pos, n.size])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
    expect(tree[0]?.children[0]).toMatchObject({ pos: 1, size: 1 })
  })

  it('renders paths', () => {
    expect(categoryPath('c', data)).toBe('A / B / C')
  })
})
