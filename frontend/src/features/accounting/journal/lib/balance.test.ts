import { amountOf, balanceOf, balancingAmount, baseAmount, sameAmount } from './balance'

describe('journal balance', () => {
  it('totals decimal strings exactly and ignores blanks and rejected drafts', () => {
    const b = balanceOf([
      { debit: '0.10', credit: '' },
      { debit: '0.20', credit: '' },
      { debit: '', credit: '0.30' },
      { debit: '#invalid', credit: '' },
    ])
    expect(b.debit.toFixed(2)).toBe('0.30')
    expect(b.credit.toFixed(2)).toBe('0.30')
    expect(b.balanced).toBe(true)
    expect(balanceOf([{ debit: '', credit: '' }]).balanced).toBe(false)
    expect(amountOf('12345678901234567.8901').toFixed(4)).toBe('12345678901234567.8901')
  })

  it('reports which side is short', () => {
    const b = balanceOf([
      { debit: '1000.00', credit: '' },
      { debit: '', credit: '800.00' },
    ])
    expect(b.difference.toFixed(2)).toBe('200.00')
    expect(b.balanced).toBe(false)
  })

  it('computes the amount that balances a line', () => {
    const lines = [
      { debit: '1200.00', credit: '' },
      { debit: '', credit: '1000.00' },
      { debit: '', credit: '' },
    ]
    expect(balancingAmount(lines, 2)).toEqual({ side: 'credit', amount: '200.00' })
    expect(balancingAmount(lines, 0)).toEqual({ side: 'debit', amount: '1000.00' })
    expect(balancingAmount([{ debit: '', credit: '' }], 0)).toBeNull()
  })

  it('previews base amounts half-up without floats', () => {
    expect(baseAmount('100.00', '34.123456')).toBe('3412.35')
    expect(baseAmount('0.10', '0.105')).toBe('0.01')
    expect(baseAmount('', '1')).toBeNull()
    expect(sameAmount('10.5', '10.5000')).toBe(true)
  })
})
