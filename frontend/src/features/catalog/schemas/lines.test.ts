import type { PriceListLine } from '../types'
import { lineKey, planLineSave, toLineValues, type PriceLineValues } from './index'

const first: PriceListLine = {
  id: 'l1',
  item_id: 'i1',
  variant_id: null,
  unit_id: 'u1',
  min_qty: '1.000000',
  price: '10.000000',
  valid_from: null,
  valid_to: null,
  version: 3,
}
const second: PriceListLine = {
  id: 'l2',
  item_id: 'i1',
  variant_id: null,
  unit_id: 'u1',
  min_qty: '100.000000',
  price: '9.000000',
  valid_from: null,
  valid_to: null,
  version: 1,
}
const server = [first, second]

const firstValues = (): PriceLineValues => toLineValues(first)

describe('planLineSave', () => {
  it('normalizes min_qty to the server key scale', () => {
    expect(lineKey({ ...first, min_qty: '1' })).toBe(lineKey(first))
  })

  it('sends every grid line without ids and carries versions of matching server lines', () => {
    const grid = [{ ...firstValues(), price: '11', min_qty: '1' }, toLineValues(second)]
    const plan = planLineSave(grid, server)
    expect(plan.removed).toEqual([])
    expect(plan.lines).toHaveLength(2)
    expect(plan.lines[0]).toEqual(expect.objectContaining({ price: '11', version: 3 }))
    expect(plan.lines[0]).not.toHaveProperty('id')
    expect(plan.lines[1]).toEqual(expect.objectContaining({ version: 1 }))
  })

  it('deletes removed lines and treats a changed key as a new line', () => {
    const grid = [{ ...firstValues(), min_qty: '5' }]
    const plan = planLineSave(grid, server)
    expect(plan.lines).toHaveLength(1)
    expect(plan.lines[0]).not.toHaveProperty('version')
    expect(plan.removed).toEqual([
      { id: 'l1', version: 3 },
      { id: 'l2', version: 1 },
    ])
  })
})
