import { formatDate, formatDateTime, toIsoDate } from './datetime'

const NY = 'America/New_York'

describe('datetime', () => {
  it('keeps calendar dates on the same day in any zone', () => {
    expect(formatDate('2026-10-21', 'tr-TR', NY)).toBe('21.10.2026')
    expect(formatDate('2026-01-01', 'tr-TR', NY)).toBe('01.01.2026')
    expect(formatDate('2026-10-21', 'en-US', 'Pacific/Kiritimati')).toBe('10/21/2026')
  })

  it('rejects impossible calendar dates', () => {
    expect(() => formatDate('2026-02-30')).toThrow(RangeError)
  })

  it('shows instants in the requested zone', () => {
    const instant = '2026-10-21T02:30:00Z'
    expect(formatDate(instant, 'tr-TR', NY)).toBe('20.10.2026')
    expect(formatDate(instant, 'tr-TR')).toBe('21.10.2026')
    expect(formatDateTime(instant, 'tr-TR', NY)).toBe('20.10.2026 22:30')
    expect(toIsoDate(new Date(instant), NY)).toBe('2026-10-20')
  })

  it('does not treat a calendar date as an instant', () => {
    expect(() => formatDateTime('2026-10-21', 'tr-TR', NY)).toThrow(RangeError)
  })
})
