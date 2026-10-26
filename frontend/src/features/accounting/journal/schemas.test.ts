import { emptyLine, type EntryValues } from './lib/lines'
import { entrySchema, type EntryMessages } from './schemas'
import type { AccountRef } from './types'

const m: EntryMessages = {
  account: 'account',
  amountRequired: 'amountRequired',
  bothSides: 'bothSides',
  party: 'party',
  costCenter: 'costCenter',
  project: 'project',
  fxAmount: 'fxAmount',
  fxRate: 'fxRate',
  minLines: 'minLines',
  maxLines: 'maxLines',
  descriptionTooLong: 'descriptionTooLong',
}

const acc = (over: Partial<AccountRef> = {}): AccountRef => ({
  id: 'a',
  code: '100',
  name: 'Kasa',
  currency_code: null,
  requires_party: false,
  requires_cost_center: false,
  requires_project: false,
  ...over,
})

const entry = (lines: EntryValues['lines']): EntryValues => ({
  entryType: 'general',
  entryDate: '2026-01-20',
  description: '',
  lines,
})

function issues(v: EntryValues) {
  const r = entrySchema(m).safeParse(v)
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`)
}

describe('journal entry schema', () => {
  it('accepts a draft with valid lines and skips blank ones', () => {
    expect(
      issues(
        entry([{ ...emptyLine(), accountId: 'a', account: acc(), debit: '10.00' }, emptyLine()]),
      ),
    ).toEqual([])
  })

  it('checks sides, account flags and currency fields per line', () => {
    const out = issues(
      entry([
        { ...emptyLine(), description: 'x' },
        { ...emptyLine(), accountId: 'a', account: acc(), debit: '1.00', credit: '1.00' },
        {
          ...emptyLine(),
          accountId: 'b',
          account: acc({
            requires_party: true,
            requires_cost_center: true,
            requires_project: true,
            currency_code: 'EUR',
          }),
          debit: '5.00',
          fxAmount: '0',
        },
      ]),
    )
    expect(out).toEqual([
      'lines.0.accountId:account',
      'lines.0.debit:amountRequired',
      'lines.1.credit:bothSides',
      'lines.2.partyId:party',
      'lines.2.costCenterId:costCenter',
      'lines.2.projectId:project',
      'lines.2.fxAmount:fxAmount',
      'lines.2.fxRate:fxRate',
    ])
  })

  it('needs at least one filled line and at most 500 lines', () => {
    expect(issues(entry([emptyLine()]))).toEqual(['lines:minLines'])
    const many = Array.from({ length: 501 }, () => ({
      ...emptyLine(),
      accountId: 'a',
      account: acc(),
      debit: '1.00',
    }))
    expect(issues(entry(many))).toEqual(['lines:maxLines'])
  })
})
