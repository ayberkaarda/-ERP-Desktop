import { explainResult, lineTotal, netUnitPrice } from './pricing'

describe('pricing helpers', () => {
  it('applies discount on decimal strings', () => {
    expect(netUnitPrice('100', '12.5')).toBe('87.5')
    expect(netUnitPrice('0.1', '10')).toBe('0.09')
    expect(netUnitPrice('19.99', '0')).toBe('19.99')
    expect(netUnitPrice(null, '5')).toBeNull()
    expect(lineTotal('87.5', '3')).toBe('262.50')
    expect(lineTotal('87.5', 'x')).toBeNull()
  })

  it('explains which step decided', () => {
    const party = explainResult({
      unit_price: '10',
      currency: 'TRY',
      price_list_id: 'pl',
      discount_percent: '5',
      source: 'party_price_list',
    })
    expect(party.partyList).toBe('decided')
    expect(party.defaultList).toBe('passed')
    expect(party.discount).toBe('decided')

    const none = explainResult({
      unit_price: null,
      currency: 'TRY',
      price_list_id: null,
      discount_percent: '0',
      source: 'none',
    })
    expect(none.partyList).toBe('skipped')
    expect(none.minQty).toBe('none')
    expect(none.discount).toBe('none')
  })
})
