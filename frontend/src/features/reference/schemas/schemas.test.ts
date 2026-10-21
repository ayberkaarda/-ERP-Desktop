import { describe, expect, it } from 'vitest'
import {
  exchangeRateSchema,
  paymentTermSchema,
  projectSchema,
  taxCodeSchema,
  toExchangeRateInput,
  toPaymentTermInput,
  toTaxCodeInput,
  toWarehouseInput,
  warehouseSchema,
  type TaxCodeFormValues,
} from './index'

const issuePaths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((i) => i.path.join('.')) ?? []

describe('exchangeRateSchema', () => {
  const valid = {
    currency_code: 'USD',
    rate_date: '2026-10-21',
    forex_buying: '41.25',
    forex_selling: '41.320000',
    banknote_buying: '',
    banknote_selling: '',
  }

  it('accepts decimal strings and drops empty banknote rates from the payload', () => {
    const parsed = exchangeRateSchema.parse(valid)
    expect(toExchangeRateInput(parsed)).toEqual({
      currency_code: 'USD',
      rate_date: '2026-10-21',
      forex_buying: '41.25',
      forex_selling: '41.320000',
      source: 'manual',
    })
  })

  it('rejects more than 6 decimals, zero and malformed values', () => {
    expect(exchangeRateSchema.safeParse({ ...valid, forex_buying: '1.1234567' }).success).toBe(
      false,
    )
    expect(exchangeRateSchema.safeParse({ ...valid, forex_buying: '0' }).success).toBe(false)
    expect(exchangeRateSchema.safeParse({ ...valid, forex_selling: '4,1' }).success).toBe(false)
    expect(exchangeRateSchema.safeParse({ ...valid, currency_code: '' }).success).toBe(false)
    expect(exchangeRateSchema.safeParse({ ...valid, rate_date: '2026-02-30' }).success).toBe(false)
  })
})

describe('taxCodeSchema', () => {
  const base: TaxCodeFormValues = {
    type: 'other',
    code: 'OZEL',
    name: 'Özel',
    rate: '',
    numerator: '',
    denominator: '',
    effective_from: '',
    effective_to: '',
    is_active: true,
  }

  it('needs a rate for VAT', () => {
    expect(issuePaths(taxCodeSchema.safeParse({ ...base, type: 'vat' }))).toContain('rate')
    expect(taxCodeSchema.safeParse({ ...base, type: 'vat', rate: '20' }).success).toBe(true)
  })

  it('needs a valid fraction for withholding and sends it as integers', () => {
    const w = { ...base, type: 'withholding' as const }
    expect(issuePaths(taxCodeSchema.safeParse(w))).toEqual(
      expect.arrayContaining(['numerator', 'denominator']),
    )
    expect(taxCodeSchema.safeParse({ ...w, numerator: '11', denominator: '10' }).success).toBe(
      false,
    )
    const ok = taxCodeSchema.parse({ ...w, numerator: '5', denominator: '10' })
    expect(toTaxCodeInput(ok)).toMatchObject({ numerator: 5, denominator: 10, rate: null })
  })

  it('drops the fraction for non-withholding types and checks the period order', () => {
    const parsed = taxCodeSchema.parse({ ...base, numerator: '3', denominator: '4' })
    expect(toTaxCodeInput(parsed)).toMatchObject({ numerator: null, denominator: null })
    expect(
      issuePaths(
        taxCodeSchema.safeParse({
          ...base,
          effective_from: '2026-05-01',
          effective_to: '2026-04-01',
        }),
      ),
    ).toContain('effective_to')
  })
})

describe('paymentTermSchema', () => {
  const base = {
    code: 'NET30',
    name: '30 gün',
    due_days: '30',
    discount_percent: '',
    discount_days: '',
    is_active: true,
  }

  it('converts to the API payload with numeric days and string percent', () => {
    const parsed = paymentTermSchema.parse({
      ...base,
      discount_percent: '2.5',
      discount_days: '10',
    })
    expect(toPaymentTermInput(parsed)).toEqual({
      code: 'NET30',
      name: '30 gün',
      due_days: 30,
      discount_percent: '2.5',
      discount_days: 10,
      is_active: true,
    })
  })

  it('requires discount days with a percent and keeps them within the due days', () => {
    expect(issuePaths(paymentTermSchema.safeParse({ ...base, discount_percent: '2' }))).toContain(
      'discount_days',
    )
    expect(
      issuePaths(
        paymentTermSchema.safeParse({ ...base, discount_percent: '2', discount_days: '45' }),
      ),
    ).toContain('discount_days')
    expect(paymentTermSchema.safeParse({ ...base, discount_percent: '101' }).success).toBe(false)
  })
})

describe('warehouse and project schemas', () => {
  it('nests only filled address fields and upper-cases the country', () => {
    const parsed = warehouseSchema.parse({
      code: 'W1',
      name: 'Depo',
      negative_stock_policy: 'warn',
      is_active: true,
      is_default: false,
      line1: ' Sokak 1 ',
      line2: '',
      district: '',
      city: 'İzmir',
      postal_code: '',
      country: 'tr',
    })
    expect(toWarehouseInput(parsed).address).toEqual({
      line1: 'Sokak 1',
      city: 'İzmir',
      country: 'TR',
    })
    expect(toWarehouseInput({ ...parsed, line1: '', city: '', country: '' }).address).toBeNull()
  })

  it('rejects an end date before the start date', () => {
    const result = projectSchema.safeParse({
      code: 'P',
      name: 'P',
      status: 'planned',
      start_date: '2026-05-01',
      end_date: '2026-04-01',
      cost_center_id: '',
    })
    expect(issuePaths(result)).toContain('end_date')
  })
})
