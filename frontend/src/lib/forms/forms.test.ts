import { ApiError } from '@/platform/types'
import {
  applyServerErrors,
  calendarDate,
  decimalString,
  MSG,
  partitionServerErrors,
  readServerError,
  snakeToCamelPath,
} from '.'

describe('server error mapping', () => {
  const body = {
    errors: {
      message: 'Doğrulama başarısız.',
      code: 'VALIDATION_FAILED',
      fields: {
        unit_price: ['Fiyat zorunlu.'],
        'lines.0.quantity': ['Miktar sıfır olamaz.'],
        ghost: [],
      },
    },
  }

  it('reads ApiError instances and raw envelopes alike', () => {
    const fromError = readServerError(new ApiError(422, 'VALIDATION_FAILED', 'x', { a: ['b'] }))
    expect(fromError).toEqual({ message: 'x', code: 'VALIDATION_FAILED', fields: { a: ['b'] } })
    expect(readServerError(body)?.fields.unit_price).toEqual(['Fiyat zorunlu.'])
    expect(readServerError(new Error('boom'))).toEqual({
      message: 'boom',
      code: undefined,
      fields: {},
    })
    expect(readServerError(null)).toBeNull()
    expect(readServerError('nope')).toBeNull()
  })

  it('maps fields to form paths and keeps the rest for the summary', () => {
    const server = readServerError(body)
    if (!server) throw new Error('expected server error')
    const parts = partitionServerErrors(server, {
      mapField: snakeToCamelPath,
      knownFields: ['unitPrice', 'lines'],
    })
    expect(parts.mapped).toEqual([
      { field: 'unitPrice', message: 'Fiyat zorunlu.' },
      { field: 'lines.0.quantity', message: 'Miktar sıfır olamaz.' },
    ])
    expect(parts.unmapped).toEqual([])

    const setError = vi.fn()
    const result = applyServerErrors(server, setError, { knownFields: ['unit_price'] })
    expect(setError).toHaveBeenCalledWith('unit_price', {
      type: 'server',
      message: 'Fiyat zorunlu.',
    })
    expect(setError).toHaveBeenCalledTimes(1)
    expect(result.unmapped).toEqual([
      { field: 'lines.0.quantity', message: 'Miktar sıfır olamaz.' },
    ])
  })

  it('converts snake_case paths segment by segment', () => {
    expect(snakeToCamelPath('lines.0.unit_price')).toBe('lines.0.unitPrice')
    expect(snakeToCamelPath('tax_number')).toBe('taxNumber')
  })
})

describe('schemas', () => {
  const issue = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
    r.error?.issues[0]?.message

  it('validates canonical decimal strings exactly', () => {
    const s = decimalString({ scale: 2, positive: true, max: '1000000' })
    expect(s.safeParse('12.50').success).toBe(true)
    expect(issue(s.safeParse(''))).toBe(MSG.required)
    expect(issue(s.safeParse('12,50'))).toBe(MSG.number)
    expect(issue(s.safeParse('1.234'))).toBe(MSG.scale)
    expect(issue(s.safeParse('0.00'))).toBe(MSG.positive)
    expect(issue(s.safeParse('1000000.01'))).toBe(MSG.max)
    expect(decimalString({ nonNegative: true }).safeParse('0').success).toBe(true)
  })

  it('accepts only real calendar dates', () => {
    expect(calendarDate().safeParse('2026-10-21').success).toBe(true)
    expect(issue(calendarDate().safeParse('2026-02-30'))).toBe(MSG.date)
    expect(issue(calendarDate().safeParse('21.10.2026'))).toBe(MSG.date)
  })
})
