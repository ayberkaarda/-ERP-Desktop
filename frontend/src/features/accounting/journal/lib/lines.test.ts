import type { AccountRef } from '../types'
import { emptyLine, lineColumns, serverFieldMapper, toEntryInput, type EntryValues } from './lines'

const usd: AccountRef = {
  id: 'usd',
  code: '102.02',
  name: 'USD',
  currency_code: 'USD',
  requires_party: false,
  requires_cost_center: false,
  requires_project: false,
}
const receivable: AccountRef = {
  ...usd,
  id: 'rec',
  code: '120',
  currency_code: null,
  requires_party: true,
}

const values = (): EntryValues => ({
  entryType: 'general',
  entryDate: '2026-01-20',
  description: ' ',
  lines: [
    {
      ...emptyLine(),
      accountId: 'usd',
      account: usd,
      debit: '3412.35',
      fxAmount: '100.00',
      fxRate: '34.123456',
    },
    emptyLine(),
    {
      ...emptyLine(),
      accountId: 'rec',
      account: receivable,
      credit: '3412.35',
      partyId: 'p1',
      fxAmount: '9',
    },
  ],
})

describe('journal line mapping', () => {
  it('builds the API payload: blanks dropped, zero side as 0.00, fx only on currency accounts', () => {
    const input = toEntryInput(values())
    expect(input.description).toBeNull()
    expect(input.lines).toHaveLength(2)
    expect(input.lines[0]).toMatchObject({
      account_id: 'usd',
      debit: '3412.35',
      credit: '0.00',
      currency_code: 'USD',
      fx_amount: '100.00',
      fx_rate: '34.123456',
    })
    expect(input.lines[1]).toMatchObject({
      account_id: 'rec',
      debit: '0.00',
      credit: '3412.35',
      currency_code: null,
      fx_amount: null,
      party_id: 'p1',
      cost_center_id: null,
    })
  })

  it('shows optional columns from account flags', () => {
    expect(lineColumns(values().lines)).toEqual({
      fx: true,
      party: true,
      costCenter: false,
      project: false,
    })
    expect(lineColumns([emptyLine()], true)).toEqual({
      fx: false,
      party: true,
      costCenter: true,
      project: true,
    })
  })

  it('maps server line indexes back across dropped blank lines', () => {
    const map = serverFieldMapper(values())
    expect(map('lines.1.party_id')).toBe('lines.2.partyId')
    expect(map('lines.0.currency_code')).toBe('lines.0.fxAmount')
    expect(map('lines.9.debit')).toBe('lines')
    expect(map('entry_date')).toBe('entryDate')
  })
})
