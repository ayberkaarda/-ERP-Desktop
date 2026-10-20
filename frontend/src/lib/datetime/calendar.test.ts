import {
  addDays,
  addMonths,
  datePartOrder,
  intlLocale,
  isValidCalendarDate,
  monthMatrix,
  parseCalendarInput,
} from '.'

describe('calendar input', () => {
  it('parses typed dates in locale order', () => {
    expect(parseCalendarInput('21.10.2026')).toBe('2026-10-21')
    expect(parseCalendarInput('1.2.2026')).toBe('2026-02-01')
    expect(parseCalendarInput('21102026')).toBe('2026-10-21')
    expect(parseCalendarInput('211026')).toBe('2026-10-21')
    expect(parseCalendarInput('21.10', 'tr-TR', 2027)).toBe('2027-10-21')
    expect(parseCalendarInput('10/21/2026', 'en-US')).toBe('2026-10-21')
    expect(parseCalendarInput('2026-10-21')).toBe('2026-10-21')
    expect(parseCalendarInput('')).toBe('')
  })

  it('rejects impossible dates instead of rolling over', () => {
    expect(parseCalendarInput('31.02.2026')).toBeNull()
    expect(parseCalendarInput('29.02.2026')).toBeNull()
    expect(parseCalendarInput('29.02.2028')).toBe('2028-02-29')
    expect(parseCalendarInput('aa.bb')).toBeNull()
    expect(parseCalendarInput('123.10.2026')).toBeNull()
    expect(isValidCalendarDate('2026-13-01')).toBe(false)
  })

  it('knows the locale part order', () => {
    expect(datePartOrder('tr-TR')).toEqual(['day', 'month', 'year'])
    expect(datePartOrder('en-US')).toEqual(['month', 'day', 'year'])
    expect(intlLocale('en')).toBe('en-GB')
    expect(intlLocale(undefined)).toBe('tr-TR')
  })

  it('builds month grids and shifts dates', () => {
    const weeks = monthMatrix(2026, 10, 1)
    // 1 October 2026 is a Thursday: three leading blanks in a Monday-first week.
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ])
    expect(weeks.flat().filter(Boolean)).toHaveLength(31)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
  })
})
