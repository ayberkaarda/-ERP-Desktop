import { decimalSeparator, formatDecimalDisplay, parseDecimalInput, toEditableText } from '.'

const money = { scale: 2 }

describe('decimal input parsing (tr-TR)', () => {
  it('turns typed Turkish amounts into canonical API strings', () => {
    expect(parseDecimalInput('1.234,5', money)).toEqual({ ok: true, value: '1234.50' })
    expect(parseDecimalInput('1234,56', money)).toEqual({ ok: true, value: '1234.56' })
    expect(parseDecimalInput('  7 ', money)).toEqual({ ok: true, value: '7.00' })
    expect(parseDecimalInput('', money)).toEqual({ ok: true, value: '' })
  })

  it('rounds half up to the scale without float drift', () => {
    expect(parseDecimalInput('0,005', money)).toEqual({ ok: true, value: '0.01' })
    expect(parseDecimalInput('1,005', money)).toEqual({ ok: true, value: '1.01' })
    expect(parseDecimalInput('2,675', money)).toEqual({ ok: true, value: '2.68' })
    expect(parseDecimalInput('12345678901234567,891', money)).toEqual({
      ok: true,
      value: '12345678901234567.89',
    })
    expect(parseDecimalInput('1,2345678', { scale: 6 })).toEqual({ ok: true, value: '1.234568' })
  })

  it('rejects malformed input and negatives unless allowed', () => {
    expect(parseDecimalInput('12,3,4', money)).toEqual({ ok: false })
    expect(parseDecimalInput('1.2.3', money)).toEqual({ ok: false })
    expect(parseDecimalInput('abc', money)).toEqual({ ok: false })
    expect(parseDecimalInput('12.5', money)).toEqual({ ok: false })
    expect(parseDecimalInput('-5', money)).toEqual({ ok: false })
    expect(parseDecimalInput('-5,5', { ...money, allowNegative: true })).toEqual({
      ok: true,
      value: '-5.50',
    })
  })

  it('honours other locales', () => {
    expect(parseDecimalInput('1,234.5', { scale: 2, locale: 'en-US' })).toEqual({
      ok: true,
      value: '1234.50',
    })
    expect(parseDecimalInput('1.234,5', { scale: 2, locale: 'de-DE' })).toEqual({
      ok: true,
      value: '1234.50',
    })
  })
})

describe('decimal display', () => {
  it('formats canonical strings for reading and editing', () => {
    expect(formatDecimalDisplay('1234567.5')).toBe('1.234.567,50')
    expect(formatDecimalDisplay('2.500', { minFraction: 0, maxFraction: 3 })).toBe('2,5')
    expect(formatDecimalDisplay('')).toBe('')
    expect(formatDecimalDisplay('99999999999999999.99')).toBe('99.999.999.999.999.999,99')
    expect(toEditableText('1234.50')).toBe('1234,5')
    expect(toEditableText('1234.50', 'en-US')).toBe('1234.5')
    expect(decimalSeparator('tr-TR')).toBe(',')
  })
})
