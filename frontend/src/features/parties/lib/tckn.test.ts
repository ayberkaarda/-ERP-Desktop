import { isValidTckn } from './tckn'

describe('isValidTckn', () => {
  // Widely used test value that satisfies both check digits.
  it('accepts a number with matching check digits', () => {
    expect(isValidTckn('10000000146')).toBe(true)
  })

  it('rejects a wrong 10th or 11th digit', () => {
    expect(isValidTckn('10000000156')).toBe(false)
    expect(isValidTckn('10000000147')).toBe(false)
  })

  it('rejects a leading zero, wrong length and non-digits', () => {
    expect(isValidTckn('00000000146')).toBe(false)
    expect(isValidTckn('1000000014')).toBe(false)
    expect(isValidTckn('1000000014a')).toBe(false)
  })
})
