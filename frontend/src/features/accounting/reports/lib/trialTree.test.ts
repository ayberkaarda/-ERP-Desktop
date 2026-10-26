import type { TrialBalanceRow } from '../types'
import { buildTrialTree, checkTotals, visibleTrialRows } from './trialTree'

const row = (
  account_id: string,
  code: string,
  parent_id: string | null = null,
): TrialBalanceRow => ({
  account_id,
  code,
  name: code,
  level: code.split('.').length,
  parent_id,
  tdhp_group: Number(code[0]),
  is_postable: true,
  opening_debit: '0',
  opening_credit: '0',
  total_debit: '0',
  total_credit: '0',
  debit: '0',
  credit: '0',
  balance_debit: '0',
  balance_credit: '0',
})

describe('trial balance tree', () => {
  const rows = [
    row('c', '102.01', 'b'),
    row('b', '102'),
    row('d', '102.01.001'),
    row('a', '100'),
    row('e', '600'),
  ]

  it('orders by code and nests by parent id or code prefix', () => {
    const tree = buildTrialTree(rows)
    expect(tree.map((n) => [n.row.code, n.depth, n.hasChildren])).toEqual([
      ['100', 0, false],
      ['102', 0, true],
      ['102.01', 1, true],
      ['102.01.001', 2, false],
      ['600', 0, false],
    ])
  })

  it('hides every descendant of a collapsed row', () => {
    const visible = visibleTrialRows(buildTrialTree(rows), new Set(['b']))
    expect(visible.map((n) => n.row.code)).toEqual(['100', '102', '600'])
  })

  it('checks debit = credit for movements and balances', () => {
    expect(
      checkTotals({
        opening_debit: '0',
        opening_credit: '0',
        debit: '100.00',
        credit: '100.0000',
        balance_debit: '50',
        balance_credit: '49.99',
      }),
    ).toEqual({
      movementsBalanced: true,
      balancesBalanced: false,
      movementDifference: '0.00',
      balanceDifference: '0.01',
    })
  })
})
