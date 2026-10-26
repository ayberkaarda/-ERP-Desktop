import { describe, expect, it } from 'vitest'
import type { RateStatus, TaxCode, TreeRow } from './types'
import {
  buildTree,
  flattenTree,
  groupByType,
  isGlobalTaxCode,
  isRateStale,
  STALE_AFTER_DAYS,
  subtreeIds,
  taxRateLabel,
  taxValidity,
} from './utils'

const row = (id: string, parent: string | null, code = id): TreeRow => ({
  id,
  parent_id: parent,
  code,
  name: `Name ${id}`,
})

const tax = (patch: Partial<TaxCode>): TaxCode => ({
  id: 't',
  company_id: null,
  type: 'vat',
  code: 'K',
  name: 'K',
  rate: null,
  numerator: null,
  denominator: null,
  effective_from: null,
  effective_to: null,
  is_active: true,
  version: 1,
  ...patch,
})

describe('tree helpers', () => {
  const rows = [row('c', 'a'), row('a', null), row('b', null), row('d', 'c')]

  it('builds a forest ordered by code, children nested with depth', () => {
    const tree = buildTree(rows)
    expect(tree.map((n) => n.row.id)).toEqual(['a', 'b'])
    expect(tree[0]?.children[0]?.row.id).toBe('c')
    expect(tree[0]?.children[0]?.children[0]).toMatchObject({ depth: 2 })
  })

  it('treats rows whose parent is missing as roots', () => {
    expect(buildTree([row('x', 'ghost')]).map((n) => n.row.id)).toEqual(['x'])
  })

  it('survives a parent cycle without looping or duplicating rows', () => {
    const cyclic = [row('p', 'q'), row('q', 'p')]
    const tree = buildTree(cyclic)
    expect(flattenTree(tree).length).toBeLessThanOrEqual(2)
  })

  it('flattens depth-first and honours collapsed nodes', () => {
    const tree = buildTree(rows)
    expect(flattenTree(tree).map((n) => n.row.id)).toEqual(['a', 'c', 'd', 'b'])
    expect(flattenTree(tree, new Set(['a'])).map((n) => n.row.id)).toEqual(['a', 'b'])
  })

  it('subtreeIds contains the node and all descendants only', () => {
    expect([...subtreeIds(rows, 'a')].sort()).toEqual(['a', 'c', 'd'])
    expect([...subtreeIds(rows, 'b')]).toEqual(['b'])
  })
})

describe('tax code helpers', () => {
  it('derives effective-date aware validity', () => {
    const code = tax({ effective_from: '2026-01-01', effective_to: '2026-12-31' })
    expect(taxValidity(code, '2025-12-31')).toBe('upcoming')
    expect(taxValidity(code, '2026-01-01')).toBe('active')
    expect(taxValidity(code, '2026-12-31')).toBe('active')
    expect(taxValidity(code, '2027-01-01')).toBe('expired')
    expect(taxValidity(tax({ is_active: false }), '2026-06-01')).toBe('inactive')
    expect(taxValidity(tax({}), '2026-06-01')).toBe('active')
  })

  it('labels rates and withholding fractions', () => {
    expect(taxRateLabel(tax({ rate: '20.0000' }))).toBe('20 %')
    expect(taxRateLabel(tax({ rate: '1.5000' }))).toBe('1.5 %')
    expect(taxRateLabel(tax({ rate: '0.0000' }))).toBe('0 %')
    expect(taxRateLabel(tax({ numerator: 5, denominator: 10 }))).toBe('5/10')
    expect(taxRateLabel(tax({}))).toBeNull()
  })

  it('marks company-less rows as global', () => {
    expect(isGlobalTaxCode(tax({ company_id: null }))).toBe(true)
    expect(isGlobalTaxCode(tax({ company_id: 'c1' }))).toBe(false)
  })

  it('groups by type in display order, dropping empty groups', () => {
    const groups = groupByType([
      tax({ id: '1', type: 'exemption', code: 'E1' }),
      tax({ id: '2', type: 'vat', code: 'K20' }),
      tax({ id: '3', type: 'vat', code: 'K10' }),
    ])
    expect(groups.map((g) => g.type)).toEqual(['vat', 'exemption'])
    expect(groups[0]?.rows.map((r) => r.code)).toEqual(['K10', 'K20'])
  })
})

describe('isRateStale', () => {
  const status = (stale_days: number | null, extra: Partial<RateStatus> = {}): RateStatus => ({
    last_fetch_date: '2026-10-16',
    stale_days,
    ...extra,
  })

  it('warns only after the 4 day limit', () => {
    expect(STALE_AFTER_DAYS).toBe(4)
    expect(isRateStale(status(0))).toBe(false)
    expect(isRateStale(status(4))).toBe(false)
    expect(isRateStale(status(5))).toBe(true)
  })

  it('prefers the server verdict and treats "never fetched" as stale', () => {
    expect(isRateStale(status(10, { is_stale: false }))).toBe(false)
    expect(isRateStale(status(1, { is_stale: true }))).toBe(true)
    expect(isRateStale({ last_fetch_date: null, stale_days: null })).toBe(true)
    expect(isRateStale(undefined)).toBe(false)
  })
})
