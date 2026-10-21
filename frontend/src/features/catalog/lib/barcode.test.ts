import {
  detectBarcodeType,
  gs1CheckDigit,
  isValidEan13,
  isValidEan8,
  isValidUpcA,
  validateBarcode,
} from './barcode'

describe('GS1 check digits', () => {
  it('computes known check digits', () => {
    expect(gs1CheckDigit('400638133393')).toBe(1) // 4006381333931
    expect(gs1CheckDigit('9638507')).toBe(4) // 96385074
    expect(gs1CheckDigit('03600029145')).toBe(2) // 036000291452
    expect(gs1CheckDigit('590123412345')).toBe(7) // 5901234123457
  })

  it('rejects non-digit payloads', () => {
    expect(() => gs1CheckDigit('12a')).toThrow()
  })

  it('validates EAN-13, EAN-8 and UPC-A', () => {
    expect(isValidEan13('4006381333931')).toBe(true)
    expect(isValidEan13('4006381333932')).toBe(false)
    expect(isValidEan13('400638133393')).toBe(false)
    expect(isValidEan8('96385074')).toBe(true)
    expect(isValidEan8('96385075')).toBe(false)
    expect(isValidUpcA('036000291452')).toBe(true)
    expect(isValidUpcA('036000291453')).toBe(false)
  })

  it('explains what is wrong', () => {
    expect(validateBarcode('', 'ean13')).toEqual({ ok: false, problem: 'empty' })
    expect(validateBarcode('40063813339X', 'ean13')).toMatchObject({ problem: 'digits' })
    expect(validateBarcode('123', 'ean8')).toMatchObject({ problem: 'length', expectedLength: 8 })
    expect(validateBarcode('4006381333930', 'ean13')).toMatchObject({
      problem: 'checkDigit',
      expected: 1,
    })
    expect(validateBarcode(' 4006381333931 ', 'ean13').ok).toBe(true)
    expect(validateBarcode('ABC-123', 'other').ok).toBe(true)
  })

  it('detects the symbology', () => {
    expect(detectBarcodeType('4006381333931')).toBe('ean13')
    expect(detectBarcodeType('036000291452')).toBe('upca')
    expect(detectBarcodeType('96385074')).toBe('ean8')
    expect(detectBarcodeType('XYZ')).toBe('other')
  })
})
