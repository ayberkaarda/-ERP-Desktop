import { describe, expect, it } from 'vitest'

import { localisedDate } from './dates'

describe('localisedDate', () => {
  it('writes ISO dates and timestamps the way the locale does', () => {
    expect(localisedDate('2026-12-01', 'tr-TR')).toBe('01.12.2026')
    expect(localisedDate('2026-12-01T00:00:00Z', 'tr-TR')).toBe('01.12.2026')
    expect(localisedDate('2026-12-01T09:30:00Z', 'tr-TR')).toBe('01.12.2026 12:30')
    expect(localisedDate('2026-12-01', 'en-US')).toBe('12/01/2026')
  })

  it('leaves everything else alone', () => {
    expect(localisedDate('2026-13-45', 'tr-TR')).toBe('2026-13-45')
    expect(localisedDate('INV-2026-12-01', 'tr-TR')).toBe('INV-2026-12-01')
    expect(localisedDate('Teslimat cuma', 'tr-TR')).toBe('Teslimat cuma')
  })
})
