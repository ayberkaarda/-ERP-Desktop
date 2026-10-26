import { createPayloadKeys } from './idempotency'

describe('payload bound idempotency keys', () => {
  it('reuses the key for an identical retry and starts over after reset', () => {
    let n = 0
    const keyFor = createPayloadKeys(() => `k${++n}`)
    expect(keyFor({ a: 1, b: 2 })).toBe('k1')
    // Same payload, other key order: a retry of the same attempt.
    expect(keyFor({ b: 2, a: 1 })).toBe('k1')
    expect(keyFor({ a: 2 })).toBe('k2')
    keyFor.reset()
    // After a success the same payload is a new request.
    expect(keyFor({ a: 2 })).toBe('k3')
  })
})
