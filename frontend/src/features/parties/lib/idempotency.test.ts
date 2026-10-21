import { createPayloadKeys, stableStringify } from './idempotency'

describe('payload-bound idempotency keys', () => {
  it('serializes objects independent of key order', () => {
    expect(stableStringify({ b: 1, a: [{ d: null, c: 'x' }] })).toBe(
      stableStringify({ a: [{ c: 'x', d: null }], b: 1 }),
    )
  })

  it('reuses the key only for an identical payload', () => {
    let n = 0
    const keyFor = createPayloadKeys(() => `k${++n}`)
    expect(keyFor({ name: 'A', roles: ['customer'] })).toBe('k1')
    expect(keyFor({ roles: ['customer'], name: 'A' })).toBe('k1')
    expect(keyFor({ name: 'B', roles: ['customer'] })).toBe('k2')
    expect(keyFor({ name: 'A', roles: ['customer'] })).toBe('k3')
  })
})
