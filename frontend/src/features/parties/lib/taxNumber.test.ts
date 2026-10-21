import { normalizeTaxNumber, taxNumberKind, taxNumberProblem } from './taxNumber'

describe('taxNumber rules', () => {
  it('picks the rule from country and party type', () => {
    expect(taxNumberKind('TR', 'company')).toBe('vkn')
    expect(taxNumberKind('tr', 'person')).toBe('tckn')
    expect(taxNumberKind('DE', 'company')).toBe('foreign')
  })

  it('validates TR companies and persons', () => {
    expect(taxNumberProblem('1234567890', 'TR', 'company')).toBeNull()
    expect(taxNumberProblem('123', 'TR', 'company')).toBe('vknLength')
    expect(taxNumberProblem('1234567891', 'TR', 'company')).toBe('vknChecksum')
    expect(taxNumberProblem('10000000146', 'TR', 'person')).toBeNull()
    expect(taxNumberProblem('1234567890', 'TR', 'person')).toBe('tcknLength')
    expect(taxNumberProblem('10000000147', 'TR', 'person')).toBe('tcknChecksum')
  })

  it('accepts any reasonable identifier abroad and empty values everywhere', () => {
    expect(taxNumberProblem('DE 123/456', 'DE', 'company')).toBeNull()
    expect(taxNumberProblem('x'.repeat(33), 'DE', 'company')).toBe('foreign')
    expect(taxNumberProblem('  ', 'TR', 'company')).toBeNull()
  })

  it('normalizes and checks like the server (TaxNumber::normalize / error)', () => {
    expect(normalizeTaxNumber(' 123.456-789 0 ', 'TR')).toBe('1234567890')
    expect(normalizeTaxNumber(' DE 123.456 ', 'DE')).toBe('DE 123.456')
    expect(taxNumberProblem('123 456 7890', 'TR', 'company')).toBeNull()
    // Non-ASCII letters are fine abroad; other symbols are not.
    expect(taxNumberProblem('ÖSTERREICH-12', 'AT', 'company')).toBeNull()
    expect(taxNumberProblem('AB#12', 'AT', 'company')).toBe('foreign')
  })
})
