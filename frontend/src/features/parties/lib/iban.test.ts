import { formatIban, ibanProblem, isValidIban, normalizeIban } from './iban'
import { BBAN_FORMATS, ibanLayout } from './ibanRegistry'

// Example IBANs from the registry / bank documentation samples.
const GB = 'GB82WEST12345698765432'
const TR = 'TR330006100519786457841326'
const DE = 'DE89370400440532013000'

describe('iban', () => {
  it('accepts valid IBANs, with or without spaces and in lower case', () => {
    expect(isValidIban(GB)).toBe(true)
    expect(isValidIban(DE)).toBe(true)
    expect(isValidIban(TR)).toBe(true)
    expect(isValidIban(formatIban(TR).toLowerCase())).toBe(true)
  })

  it('normalizes and formats', () => {
    expect(normalizeIban(' tr33 0006 1005 ')).toBe('TR3300061005')
    expect(formatIban(GB)).toBe('GB82 WEST 1234 5698 7654 32')
  })

  it('rejects countries without an IBAN even when the checksum passes', () => {
    // Both satisfy mod 97 = 1 but break the registry.
    expect(ibanProblem('ZZ6600000000000')).toBe('country')
    expect(ibanProblem('SA1000000000000')).toBe('length')
  })

  it('reports the broken rule', () => {
    expect(ibanProblem('not an iban')).toBe('format')
    expect(ibanProblem('TR33000610051978645784132')).toBe('length')
    // GB needs four letters (bank code) after the check digits.
    expect(ibanProblem('GB821234123456987654320')).toBe('length')
    expect(ibanProblem('GB8212341234569876543A')).toBe('bban')
    expect(ibanProblem('TR330006110519786457841326')).toBe('trFormat')
    expect(ibanProblem('GB83WEST12345698765432')).toBe('checksum')
  })
})

describe('iban registry', () => {
  it('derives lengths within the ISO 13616 range for every country', () => {
    for (const country of Object.keys(BBAN_FORMATS)) {
      const layout = ibanLayout(country)
      expect(layout?.length).toBeGreaterThanOrEqual(15)
      expect(layout?.length).toBeLessThanOrEqual(34)
    }
    expect(ibanLayout('TR')?.length).toBe(26)
    expect(ibanLayout('NO')?.length).toBe(15)
    expect(ibanLayout('LC')?.length).toBe(32)
    expect(ibanLayout('ZZ')).toBeNull()
    expect(ibanLayout('constructor')).toBeNull()
  })
})
