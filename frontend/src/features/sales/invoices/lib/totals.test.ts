import { documentAmounts, lineAmounts, toLocal } from './totals'

const line = (
  quantity: string,
  unitPrice: string,
  over: Partial<Parameters<typeof lineAmounts>[0]> = {},
) => ({
  quantity,
  unitPrice,
  discountPercent: '0',
  discountAmount: '0',
  taxRate: '20',
  ...over,
})

describe('invoice line maths', () => {
  it('applies percent then amount discount, rounding net and tax per line', () => {
    expect(
      lineAmounts(line('3', '33.335', { discountPercent: '10', discountAmount: '1' })),
    ).toEqual({
      gross: '100.01',
      discount: '11.01',
      net: '89.00',
      tax: '17.80',
      total: '106.80',
    })
  })

  it('rounds half up at the currency scale without float drift', () => {
    // 0.1 × 3 = 0.30 exactly; 1.005 rounds up to 1.01.
    expect(lineAmounts(line('3', '0.1', { taxRate: '0' })).net).toBe('0.30')
    expect(lineAmounts(line('1', '1.005', { taxRate: '0' })).net).toBe('1.01')
    expect(lineAmounts(line('1', '0.025', { taxRate: '20' })).tax).toBe('0.01')
  })

  it('clamps discount percent to 0..100 and treats bad input as zero', () => {
    expect(lineAmounts(line('1', '10', { discountPercent: '150' })).net).toBe('0.00')
    expect(lineAmounts(line('abc', '10')).total).toBe('0.00')
  })

  it('sums rounded lines so the total equals the printed lines, with tax per rate', () => {
    const t = documentAmounts([
      line('1', '0.333'),
      line('1', '0.333'),
      line('1', '0.333'),
      line('2', '50', { taxRate: '10' }),
    ])
    // Each 0.333 line nets 0.33 (tax 0.07); a total-level rounding would give 1.00 instead of 0.99.
    expect(t.subtotal).toBe('100.99')
    expect(t.tax_total).toBe('10.21')
    expect(t.total).toBe('111.20')
    expect(t.byRate).toEqual([
      { rate: '10', base: '100.00', tax: '10.00' },
      { rate: '20', base: '0.99', tax: '0.21' },
    ])
  })

  it('converts to company currency with a single rounding', () => {
    expect(toLocal('1234.56', '34.123456')).toBe('42127.45')
    expect(toLocal('10', '')).toBe('10.00')
  })
})
