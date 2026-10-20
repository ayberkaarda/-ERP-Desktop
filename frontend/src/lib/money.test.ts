import { formatMoney, parseDecimal, sum } from './money'

describe('money', () => {
  it('sums without float drift', () => {
    expect(sum(['0.1', '0.2']).toString()).toBe('0.3')
  })

  it('formats TRY in Turkish locale', () => {
    expect(formatMoney('1234567.891').replace(/\s/g, ' ')).toBe('₺1.234.567,89')
  })

  it('parses Turkish input', () => {
    expect(parseDecimal('1.234,56')?.toString()).toBe('1234.56')
    expect(parseDecimal('-12,5')?.toString()).toBe('-12.5')
    expect(parseDecimal('12,3,4')).toBeNull()
    expect(parseDecimal('abc')).toBeNull()
  })

  it('accepts only well-formed thousands grouping', () => {
    expect(parseDecimal('1.234.567')?.toString()).toBe('1234567')
    expect(parseDecimal('1234567,5')?.toString()).toBe('1234567.5')
    expect(parseDecimal('1.2.3,45')).toBeNull()
    expect(parseDecimal('12.34')).toBeNull()
    expect(parseDecimal('1.2345,6')).toBeNull()
    expect(parseDecimal('.123')).toBeNull()
    expect(parseDecimal('1,234.56', 'en-US')?.toString()).toBe('1234.56')
    expect(parseDecimal('1.234,56', 'en-US')).toBeNull()
  })

  it('rounds half up', () => {
    expect(formatMoney('0.005')).toBe('₺0,01')
  })
})
