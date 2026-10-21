import { ibanProblem, isValidIban } from './iban'
import { BBAN_FORMATS, ibanLayout } from './ibanRegistry'
import registryJson from '../../../../../contracts/iban-registry.json?raw'

interface Entry {
  length: number
  bban_pattern: string
  example: string
}

const contract = (JSON.parse(registryJson) as { countries: Record<string, Entry> }).countries

const entries = Object.entries(contract)

describe('iban registry contract', () => {
  it('embeds exactly the countries, patterns and lengths of contracts/iban-registry.json', () => {
    expect(Object.keys(BBAN_FORMATS).sort()).toEqual(Object.keys(contract).sort())
    for (const [country, entry] of entries) {
      expect(BBAN_FORMATS[country], country).toBe(entry.bban_pattern)
      expect(ibanLayout(country)?.length, country).toBe(entry.length)
    }
  })

  it.each(entries)('validates the published registry example for %s', (country, entry) => {
    expect(entry.example).toHaveLength(entry.length)
    expect(entry.example.startsWith(country)).toBe(true)
    expect(isValidIban(entry.example)).toBe(true)
  })

  it.each(entries)('rejects the %s example once its check digits are mutated', (_country, entry) => {
    const check = Number(entry.example.slice(2, 4))
    const mutated = String(((check - 2 + 1) % 97) + 2).padStart(2, '0')
    const iban = entry.example.slice(0, 2) + mutated + entry.example.slice(4)
    expect(iban).not.toBe(entry.example)
    expect(isValidIban(iban)).toBe(false)
  })

  it.each(entries)('rejects the %s example one character too long or too short', (_c, entry) => {
    expect(ibanProblem(`${entry.example}0`)).toBe('length')
    expect(ibanProblem(entry.example.slice(0, -1))).toBe('length')
  })
})
