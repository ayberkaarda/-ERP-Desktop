import { intlLocale } from './locale'

describe('intlLocale', () => {
  it('keeps supported regional locales and defaults bare languages', () => {
    expect(intlLocale('en-US')).toBe('en-US')
    expect(intlLocale('de-CH')).toBe('de-CH')
    expect(intlLocale('fr-CA')).toBe('fr-CA')
    expect(intlLocale('en')).toBe('en-GB')
    expect(intlLocale('tr')).toBe('tr-TR')
    expect(intlLocale('ja-JP')).toBe('tr-TR')
    expect(intlLocale(undefined)).toBe('tr-TR')
    expect(intlLocale('constructor')).toBe('tr-TR')
  })
})
