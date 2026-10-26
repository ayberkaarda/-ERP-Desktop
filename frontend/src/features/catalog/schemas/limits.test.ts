import { factorString, itemUnitSchema, priceLineSchema } from './index'

const line = {
  id: '',
  item_id: 'i',
  variant_id: '',
  unit_id: 'u',
  min_qty: '1',
  price: '10',
  valid_from: '',
  valid_to: '',
}

describe('numeric(20,6) limits', () => {
  it('rejects factors that do not fit', () => {
    expect(factorString.safeParse('99999999999999.999999').success).toBe(true)
    expect(factorString.safeParse('100000000000000').success).toBe(false)
    expect(factorString.safeParse('1.0000001').success).toBe(false)
    expect(itemUnitSchema.safeParse({ unit_id: 'u', factor: '100000000000000' }).success).toBe(
      false,
    )
  })

  it('rejects line prices and quantities that do not fit', () => {
    expect(priceLineSchema.safeParse(line).success).toBe(true)
    expect(priceLineSchema.safeParse({ ...line, price: '100000000000000' }).success).toBe(false)
    expect(priceLineSchema.safeParse({ ...line, min_qty: '100000000000000' }).success).toBe(false)
  })
})
