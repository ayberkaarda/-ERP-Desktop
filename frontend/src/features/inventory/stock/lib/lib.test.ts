import { buildLocationTree, visibleNodes, parentOf } from '../../warehouses/lib/locationTree'
import type { WarehouseLocationRef } from '../../shared/warehouses'
import { balanceParams, exportListParams, movementFilterParams } from './api'
import { daysUntil, expiryState } from './expiry'
import { formatAmount, formatQuantity, isNegative } from './format'
import { invKeysFor } from './keys'
import { sanitizeViews } from './savedViews'

const loc = (
  id: string,
  code: string,
  parent: string | null = null,
  over: Partial<WarehouseLocationRef> = {},
): WarehouseLocationRef => ({
  id,
  warehouse_id: 'w',
  code,
  name: code,
  is_active: true,
  parent_id: parent,
  ...over,
})

describe('location tree', () => {
  it('nests locations by parent_id and sorts codes naturally', () => {
    const tree = buildLocationTree([
      loc('3', 'A-01-03', '2'),
      loc('1', 'A'),
      loc('4', 'B'),
      loc('2', 'A-01', '1'),
      loc('5', 'A-10', '1'),
      loc('6', 'A-2', '1'),
    ])
    expect(tree.map((n) => n.location.code)).toEqual(['A', 'B'])
    const a = tree[0]
    expect(a?.children.map((n) => n.location.code)).toEqual(['A-01', 'A-2', 'A-10'])
    expect(a?.children[0]?.children.map((n) => [n.location.code, n.depth])).toEqual([
      ['A-01-03', 2],
    ])
  })

  it('treats unknown parents as roots and survives cycles', () => {
    const parents = parentOf([loc('1', 'X'), loc('2', 'Y', '1'), loc('3', 'Z', 'missing')])
    expect([...parents.entries()]).toEqual([
      ['1', null],
      ['2', '1'],
      ['3', null],
    ])
    const cyclic = buildLocationTree([loc('1', 'P', '2'), loc('2', 'Q', '1')])
    const all = visibleNodes(cyclic, new Set(['1', '2']))
    expect(all.map((n) => n.location.id).sort()).toEqual(['1', '2'])
  })

  it('lists only expanded branches', () => {
    const tree = buildLocationTree([loc('1', 'A'), loc('2', 'A-01', '1'), loc('3', 'B')])
    expect(visibleNodes(tree, new Set()).map((n) => n.location.code)).toEqual(['A', 'B'])
    expect(visibleNodes(tree, new Set(['1'])).map((n) => n.location.code)).toEqual([
      'A',
      'A-01',
      'B',
    ])
  })
})

describe('expiry', () => {
  it('classifies by calendar date', () => {
    expect(expiryState(null, '2026-10-21')).toBe('none')
    expect(expiryState('2026-10-20', '2026-10-21')).toBe('expired')
    expect(expiryState('2026-10-21', '2026-10-21')).toBe('soon')
    expect(expiryState('2026-11-20', '2026-10-21')).toBe('soon')
    expect(expiryState('2026-11-21', '2026-10-21')).toBe('ok')
    expect(daysUntil('2026-11-01', '2026-10-21')).toBe(11)
    expect(daysUntil('2026-03-30', '2026-03-28')).toBe(2)
  })
})

describe('decimal formatting', () => {
  it('formats quantities and money from strings without floats', () => {
    expect(formatQuantity('1250.500000', 'tr-TR')).toBe('1.250,5')
    expect(formatQuantity('12345678901234.123456', 'en-US')).toBe('12,345,678,901,234.123456')
    expect(formatAmount('3126.2500', 'tr-TR')).toBe('3.126,25')
    expect(formatAmount('2.123456', 'tr-TR', 6)).toBe('2,123456')
    expect(isNegative('-0.000000')).toBe(false)
    expect(isNegative('-2.5')).toBe(true)
  })
})

describe('api helpers', () => {
  it('sends the grouping as group_by and leaves paging out of exports', () => {
    const query = {
      page: 2,
      perPage: 50,
      sort: [{ id: 'item_code', desc: false }],
      q: 'civata',
      filters: { group: 'detail', warehouse_id: 'w1' },
    }
    expect(balanceParams(query)).toEqual({
      page: 2,
      per_page: 50,
      sort: 'item_code',
      q: 'civata',
      'filter[warehouse_id]': 'w1',
      group_by: 'detail',
    })
    expect(balanceParams({ ...query, filters: {} }, false)).toEqual({
      sort: 'item_code',
      q: 'civata',
      group_by: 'warehouse',
    })
    expect(exportListParams({ ...query, filters: { expired: 'true' } })).toEqual({
      sort: 'item_code',
      q: 'civata',
      'filter[expired]': 'true',
    })
    expect(movementFilterParams({ lot_id: 'l1', direction: '' })).toEqual({
      'filter[lot_id]': 'l1',
    })
  })

  it('scopes query keys by company', () => {
    expect(invKeysFor('c1').lots()).toEqual(['inventory', 'c1', 'stock-views', 'lots'])
    expect(invKeysFor(null).all[1]).toBe('no-company')
    expect(invKeysFor('c1').itemStock('i')).not.toEqual(invKeysFor('c2').itemStock('i'))
  })

  it('drops malformed saved views', () => {
    expect(
      sanitizeViews([{ name: 'ok', values: { a: 'b', n: 1 } }, { name: '' }, 'x', null]),
    ).toEqual([{ name: 'ok', values: { a: 'b' } }])
    expect(sanitizeViews({})).toEqual([])
  })
})
