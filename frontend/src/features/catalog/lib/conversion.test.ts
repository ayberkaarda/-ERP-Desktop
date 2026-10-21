import type { UnitConversion } from '../types'
import {
  conversionMatrix,
  convertQty,
  diffMatrix,
  inverseFactor,
  isPositiveFactor,
  normalize,
  pairKey,
} from './conversion'

const conv = (id: string, from: string, to: string, factor: string): UnitConversion => ({
  id,
  from_unit_id: from,
  to_unit_id: to,
  factor,
  version: 1,
})

describe('unit conversion math', () => {
  it('validates factors as positive decimal strings', () => {
    expect(isPositiveFactor('12')).toBe(true)
    expect(isPositiveFactor('0.000001')).toBe(true)
    expect(isPositiveFactor('0')).toBe(false)
    expect(isPositiveFactor('-1')).toBe(false)
    expect(isPositiveFactor('1,5')).toBe(false)
    expect(isPositiveFactor('')).toBe(false)
  })

  it('converts without float drift', () => {
    expect(convertQty('3', '12')).toBe('36')
    expect(convertQty('0.1', '0.2')).toBe('0.02')
    expect(convertQty('1.5', '0.333333')).toBe('0.5')
    expect(convertQty('x', '1')).toBeNull()
    expect(normalize('12.500000')).toBe('12.5')
  })

  it('inverts at the API scale', () => {
    expect(inverseFactor('12')).toBe('0.083333')
    expect(inverseFactor('1000')).toBe('0.001')
    expect(inverseFactor('0')).toBeNull()
  })

  it('builds a matrix with implied reverse cells', () => {
    const m = conversionMatrix([conv('1', 'box', 'pc', '12'), conv('2', 'kg', 'g', '1000')])
    expect(m.get(pairKey('box', 'pc'))?.conversion?.id).toBe('1')
    expect(m.get(pairKey('pc', 'box'))?.implied).toBe('0.083333')
    expect(m.get(pairKey('g', 'kg'))?.implied).toBe('0.001')
  })

  it('diffs edits into operations', () => {
    const stored = [conv('1', 'box', 'pc', '12.000000'), conv('2', 'kg', 'g', '1000')]
    const changes = diffMatrix(stored, {
      'box>pc': '12',
      'kg>g': '',
      'pc>box': '0.5',
      'l>ml': '1000',
      'l>l': '1',
    })
    expect(changes).toEqual([
      { kind: 'delete', conversion: stored[1] },
      { kind: 'create', from: 'pc', to: 'box', factor: '0.5' },
      { kind: 'create', from: 'l', to: 'ml', factor: '1000' },
    ])
    expect(diffMatrix(stored, { 'box>pc': '24' })).toEqual([
      { kind: 'update', conversion: stored[0], factor: '24' },
    ])
  })
})
