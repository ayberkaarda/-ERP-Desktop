import { documentTotal, lineAmount } from '.'

describe('document rounding rule', () => {
  it('rounds each line half-up before summing', () => {
    const lines = Array.from({ length: 3 }, () => ({ quantity: '0.333', unitPrice: '1.00' }))
    // Unrounded the sum would be 0.999 -> 1.00; the printed lines are 0.33 each.
    expect(lines.map((l) => lineAmount(l.quantity, l.unitPrice).toFixed(2))).toEqual([
      '0.33',
      '0.33',
      '0.33',
    ])
    expect(documentTotal(lines).toFixed(2)).toBe('0.99')
    expect(lineAmount('2.5', '0.01').toFixed(2)).toBe('0.03')
    expect(lineAmount('1.000', '12.3456', 4).toFixed(4)).toBe('12.3456')
  })
})
