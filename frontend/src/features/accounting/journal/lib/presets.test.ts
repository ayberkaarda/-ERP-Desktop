import { act, renderHook } from '@testing-library/react'
import { createPayloadKeys, stableStringify } from './idempotency'
import { readPresets, sanitizePresets, usePresets } from './presets'

describe('presets', () => {
  beforeEach(() => window.localStorage.clear())

  it('keeps only well-formed, allowed entries from storage', () => {
    const raw = [
      { name: 'Ocak', params: { date_from: '2026-01-01', evil: 'x' } },
      { name: '', params: {} },
      { name: 'Ocak', params: {} },
      { name: 'Bozuk', params: { level: 3 } },
      'junk',
    ]
    expect(sanitizePresets(raw, ['date_from', 'level'])).toEqual([
      { name: 'Ocak', params: { date_from: '2026-01-01' } },
      { name: 'Bozuk', params: {} },
    ])
    expect(sanitizePresets({})).toEqual([])
  })

  it('saves, replaces by name and removes', () => {
    const { result } = renderHook(() => usePresets('t'))
    act(() => result.current.save({ name: ' A ', params: { q: '1' } }))
    act(() => result.current.save({ name: 'A', params: { q: '2' } }))
    expect(readPresets('t')).toEqual([{ name: 'A', params: { q: '2' } }])
    act(() => result.current.remove('A'))
    expect(readPresets('t')).toEqual([])
  })
})

describe('payload-bound idempotency keys', () => {
  it('reuses the key for an identical payload and renews it on change', () => {
    let n = 0
    const keyFor = createPayloadKeys(() => `k${++n}`)
    expect(keyFor({ b: 1, a: [1, 2] })).toBe('k1')
    expect(keyFor({ a: [1, 2], b: 1 })).toBe('k1')
    expect(keyFor({ a: [1, 3], b: 1 })).toBe('k2')
    expect(stableStringify({ z: undefined, a: null })).toBe('{"a":null}')
  })
})
