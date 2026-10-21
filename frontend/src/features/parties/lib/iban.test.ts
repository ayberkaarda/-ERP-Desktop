import { formatIban, ibanProblem, isValidIban, normalizeIban } from './iban'

// Example IBANs from the ISO 13616 / bank documentation samples.
const GB = 'GB82WEST12345698765432'
const TR = 'TR330006100519786457841326'

describe('iban', () => {
  it('accepts valid IBANs, with or without spaces and in lower case', () => {
    expect(isValidIban(GB)).toBe(true)
    expect(isValidIban(TR)).toBe(true)
    expect(isValidIban(formatIban(TR).toLowerCase())).toBe(true)
  })

  it('normalizes and formats', () => {
    expect(normalizeIban(' tr33 0006 1005 ')).toBe('TR3300061005')
    expect(formatIban(GB)).toBe('GB82 WEST 1234 5698 7654 32')
  })

  it('reports the broken rule', () => {
    expect(ibanProblem('not an iban')).toBe('format')
    expect(ibanProblem('TR33000610051978645784132')).toBe('length')
    expect(ibanProblem('TR330006110519786457841326')).toBe('trFormat')
    expect(ibanProblem('GB83WEST12345698765432')).toBe('checksum')
  })
})
