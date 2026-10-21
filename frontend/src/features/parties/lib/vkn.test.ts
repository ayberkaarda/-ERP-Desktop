import { isValidVkn } from './vkn'

describe('isValidVkn', () => {
  it('accepts a number whose check digit matches', () => {
    expect(isValidVkn('1234567890')).toBe(true)
  })

  it('rejects a wrong check digit', () => {
    expect(isValidVkn('1234567891')).toBe(false)
  })

  it('rejects wrong length and non-digits', () => {
    expect(isValidVkn('123456789')).toBe(false)
    expect(isValidVkn('12345678901')).toBe(false)
    expect(isValidVkn('12345678a0')).toBe(false)
  })

  it('has exactly one valid check digit for any 9-digit prefix', () => {
    const valid = Array.from({ length: 10 }, (_, c) => `987654321${c}`).filter(isValidVkn)
    expect(valid).toHaveLength(1)
  })
})
