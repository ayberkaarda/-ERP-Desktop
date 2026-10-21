import type { CustomerExposure } from '../kit/types'
import { documentInRisk } from './exposure'

const exposure = (over: Partial<CustomerExposure> = {}): CustomerExposure => ({
  limit: '1000',
  currency: 'EUR',
  open_invoices: '200',
  open_orders: '100',
  total: '300',
  available: '700',
  ...over,
})
const tryInvoice = { currency_code: 'TRY', total: '35000.00', total_local: '35000.00' }

describe('document against the risk limit', () => {
  it('never subtracts company-currency amounts from a foreign risk limit', () => {
    const r = documentInRisk(exposure(), tryInvoice, 'TRY')
    expect(r.after).toBeNull()
    expect(r).toMatchObject({ amount: '35000.00', currency: 'TRY' })
  })

  it('uses the server amount in the risk currency when given', () => {
    const r = documentInRisk(exposure({ document_amount: '1000.00' }), tryInvoice, 'TRY')
    expect(r).toMatchObject({ amount: '1000.00', currency: 'EUR' })
    expect(r.after?.toString()).toBe('-300')
  })

  it('subtracts when the currencies match', () => {
    expect(
      documentInRisk(exposure(), { currency_code: 'EUR', total: '50' }, 'TRY').after?.toString(),
    ).toBe('650')
    expect(
      documentInRisk(
        exposure({ currency: 'TRY', available: '500' }),
        { currency_code: 'EUR', total: '10', total_local: '350' },
        'TRY',
      ).after?.toString(),
    ).toBe('150')
    expect(
      documentInRisk(exposure({ available: null }), { currency_code: 'EUR', total: '50' }, 'TRY')
        .after,
    ).toBeNull()
  })
})
