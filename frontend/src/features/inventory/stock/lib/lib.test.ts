import { buildLocationTree, visibleNodes, parentOf } from '../../warehouses/lib/locationTree'
import { cursorMeta } from './api'
import { daysUntil, expiryState } from './expiry'
import { formatAmount, formatQuantity, isBelow, isNegative } from './format'
import { createPayloadKeys } from './idempotency'
import { invKeysFor } from './keys'
import { sanitizeViews } from './savedViews'
import type { WarehouseLocation } from './types'

const loc = (
  id: string,
  code: string,
  over: Partial<WarehouseLocation> = {},
): WarehouseLocation => ({
  id,
  warehouse_id: 'w',
  code,
  name: code,
  is_active: true,
  ...over,
})

describe('location tree', () => {
  it('nests bins by their codes and skips missing levels', () => {
    const tree = buildLocationTree([
      loc('3', 'A-01-03'),
      loc('1', 'A'),
      loc('4', 'B.2'),
      loc('5', 'C/01/07'),
      loc('2', 'A-01'),
      loc('6', 'C'),
    ])
    expect(tree.map((n) => n.location.code)).toEqual(['A', 'B.2', 'C'])
    const a = tree[0]
    expect(a?.children.map((n) => n.location.code)).toEqual(['A-01'])
    expect(a?.children[0]?.children.map((n) => [n.location.code, n.depth])).toEqual([
      ['A-01-03', 2],
    ])
    // C/01 does not exist, so C/01/07 hangs directly under C.
    expect(tree[2]?.children.map((n) => n.location.code)).toEqual(['C/01/07'])
  })

  it('sorts codes naturally and matches case-insensitively', () => {
    const tree = buildLocationTree([loc('1', 'a'), loc('2', 'A-10'), loc('3', 'A-2')])
    expect(tree[0]?.children.map((n) => n.location.code)).toEqual(['A-2', 'A-10'])
  })

  it('follows explicit parent ids when the API sends them and survives cycles', () => {
    const parents = parentOf([
      loc('1', 'X', { parent_id: null }),
      loc('2', 'Y', { parent_id: '1' }),
      loc('3', 'Z', { parent_id: 'missing' }),
    ])
    expect([...parents.entries()]).toEqual([
      ['1', null],
      ['2', '1'],
      ['3', null],
    ])
    const cyclic = buildLocationTree([
      loc('1', 'P', { parent_id: '2' }),
      loc('2', 'Q', { parent_id: '1' }),
    ])
    const all = visibleNodes(cyclic, new Set(['1', '2']))
    expect(all.map((n) => n.location.id).sort()).toEqual(['1', '2'])
  })

  it('lists only expanded branches', () => {
    const tree = buildLocationTree([loc('1', 'A'), loc('2', 'A-01'), loc('3', 'B')])
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
    expect(isBelow('49.999999', '50')).toBe(true)
    expect(isBelow('50', '50')).toBe(false)
    expect(isBelow('1', null)).toBe(false)
  })
})

describe('api helpers', () => {
  it('reads cursor meta from either place', () => {
    expect(cursorMeta({ next_cursor: 'a', prev_cursor: null, per_page: 10 }).next_cursor).toBe('a')
    expect(
      cursorMeta({ pagination: { next_cursor: 'b', prev_cursor: null, per_page: 10 } }).next_cursor,
    ).toBe('b')
    expect(cursorMeta(undefined).next_cursor).toBeNull()
  })

  it('scopes query keys by company', () => {
    expect(invKeysFor('c1').warehouses()).toEqual(['inventory', 'c1', 'stock-views', 'warehouses'])
    expect(invKeysFor(null).all[1]).toBe('no-company')
    expect(invKeysFor('c1').itemStock('i')).not.toEqual(invKeysFor('c2').itemStock('i'))
  })

  it('reuses an idempotency key only for an identical payload', () => {
    let n = 0
    const keys = createPayloadKeys(() => `k${++n}`)
    expect(keys({ a: 1, b: 2 })).toBe('k1')
    expect(keys({ b: 2, a: 1 })).toBe('k1')
    expect(keys({ a: 2 })).toBe('k2')
  })

  it('drops malformed saved views', () => {
    expect(
      sanitizeViews([{ name: 'ok', values: { a: 'b', n: 1 } }, { name: '' }, 'x', null]),
    ).toEqual([{ name: 'ok', values: { a: 'b' } }])
    expect(sanitizeViews({})).toEqual([])
  })
})
