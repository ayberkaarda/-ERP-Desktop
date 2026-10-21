import { ApiError } from '@/platform'
import type { DeterminationRule, FiscalYear } from '../../shared/types'
import {
  applyPriorityChanges,
  conditionIssues,
  movePriority,
  groupRules,
  PriorityMoveError,
  rowsToConditions,
  conditionsToRows,
} from '../../determination/lib/rules'
import { allowedActions, pickDefaultYear, readBlockedReason } from '../../periods/lib/periods'
import { overlaps, planPeriods, suggestNextYear } from './periods'

describe('period planning', () => {
  it('tiles a calendar year in 12 months plus an optional zero-length 13th', () => {
    const p = planPeriods('2027-01-01', '2027-12-31', true)
    expect(p).toHaveLength(13)
    expect(p[1]).toEqual({ number: 2, start_date: '2027-02-01', end_date: '2027-02-28' })
    expect(p[11]).toEqual({ number: 12, start_date: '2027-12-01', end_date: '2027-12-31' })
    expect(p[12]).toEqual({ number: 13, start_date: '2027-12-31', end_date: '2027-12-31' })
  })

  it('handles a non-calendar year and rejects bad ranges', () => {
    const p = planPeriods('2026-07-01', '2027-06-30', false)
    expect(p[0]?.end_date).toBe('2026-07-31')
    expect(p[6]?.start_date).toBe('2027-01-01')
    expect(p.at(-1)?.end_date).toBe('2027-06-30')
    expect(planPeriods('2027-12-31', '2027-01-01', false)).toEqual([])
  })

  it('suggests the year after the latest one and detects overlaps', () => {
    const years = [{ end_date: '2026-12-31' }, { end_date: '2025-12-31' }] as FiscalYear[]
    expect(suggestNextYear(years, '2026-10-21')).toEqual({
      code: '2027',
      start_date: '2027-01-01',
      end_date: '2027-12-31',
    })
    expect(suggestNextYear([], '2026-10-21').start_date).toBe('2026-01-01')
    expect(overlaps('2026-06-01', '2027-05-31', '2026-01-01', '2026-12-31')).toBe(true)
    expect(overlaps('2027-01-01', '2027-12-31', '2026-01-01', '2026-12-31')).toBe(false)
  })
})

describe('period transitions', () => {
  it('allows the PHASE3 transitions per status', () => {
    const p = { status: 'soft_closed' } as Parameters<typeof allowedActions>[0]
    expect(allowedActions(p)).toEqual(['close', 'reopen'])
  })

  it('recognizes a draft-entries refusal and reads the count', () => {
    const e = new ApiError(422, 'PERIOD_HAS_DRAFT_ENTRIES', 'Taslak var', {
      draft_entries: ['4 taslak fiş var.'],
    })
    expect(readBlockedReason(e)).toEqual({
      message: 'Taslak var',
      draftCount: 4,
      details: ['4 taslak fiş var.'],
    })
    expect(
      readBlockedReason(new ApiError(422, 'VALIDATION_ERROR', 'x', { reason: ['y'] })),
    ).toBeNull()
  })

  it('recognizes the API refusal on status and ignores other status refusals', () => {
    const message = 'Dönemde hâlâ 2 taslak yevmiye maddesi var.'
    const e = new ApiError(422, 'VALIDATION_ERROR', message, { status: [message] })
    expect(readBlockedReason(e)?.draftCount).toBe(2)
    const closedYear = new ApiError(422, 'VALIDATION_ERROR', 'x', {
      status: ['The fiscal year 2026 is closed (period 3).'],
    })
    expect(readBlockedReason(closedYear)).toBeNull()
  })

  it('picks the remembered, then the current, then the latest year', () => {
    const years = [
      { id: 'b', start_date: '2027-01-01', end_date: '2027-12-31' },
      { id: 'a', start_date: '2026-01-01', end_date: '2026-12-31' },
    ] as FiscalYear[]
    expect(pickDefaultYear(years, '2026-05-01', null)).toBe('a')
    expect(pickDefaultYear(years, '2026-05-01', 'b')).toBe('b')
    expect(pickDefaultYear(years, '2030-01-01', 'gone')).toBe('b')
  })
})

describe('determination rules', () => {
  const rule = (id: string, priority: number, event = 'sales.revenue.goods') =>
    ({ id, priority, event_key: event, version: 1, conditions: {} }) as DeterminationRule

  it('swaps priorities, or splits equal ones, when moving', () => {
    const ordered = [rule('a', 30), rule('b', 20), rule('c', 20)]
    expect(movePriority(ordered, 'b', 'up').map((c) => [c.rule.id, c.priority])).toEqual([
      ['b', 30],
      ['a', 20],
    ])
    expect(movePriority(ordered, 'c', 'up').map((c) => [c.rule.id, c.priority])).toEqual([
      ['c', 21],
    ])
    expect(movePriority(ordered, 'a', 'up')).toEqual([])
  })

  it('moves the last of equal priorities exactly one place, keeping the others in order', () => {
    const ordered = [rule('a', 30), rule('b', 20), rule('c', 20), rule('d', 20)]
    const changes = movePriority(ordered, 'd', 'up')
    const after = ordered
      .map((r) => ({
        id: r.id,
        p: changes.find((c) => c.rule.id === r.id)?.priority ?? r.priority,
      }))
      .sort((x, y) => y.p - x.p)
      .map((x) => x.id)
    expect(after).toEqual(['a', 'b', 'd', 'c'])
    // No integer room between neighbours: the group is respaced, order still adjacent.
    const tight = [rule('a', 21), rule('b', 20), rule('c', 20), rule('d', 19)]
    const respaced = movePriority(tight, 'c', 'up')
    const order = tight
      .map((r) => ({
        id: r.id,
        p: respaced.find((c) => c.rule.id === r.id)?.priority ?? r.priority,
      }))
      .sort((x, y) => y.p - x.p)
      .map((x) => x.id)
    expect(order).toEqual(['a', 'c', 'b', 'd'])
  })

  it('rolls back applied edits when a later one fails', async () => {
    const calls: [string, number, number][] = []
    const update = (id: string, version: number, priority: number) => {
      calls.push([id, version, priority])
      if (id === 'b' && priority === 30) return Promise.reject(new Error('boom'))
      return Promise.resolve({ ...rule(id, priority), version: version + 1 })
    }
    const changes = [
      { rule: rule('a', 30), priority: 20 },
      { rule: rule('b', 20), priority: 30 },
    ]
    const error = await applyPriorityChanges(changes, update).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PriorityMoveError)
    expect((error as PriorityMoveError).rolledBack).toBe(true)
    expect(calls).toEqual([
      ['a', 1, 20],
      ['b', 1, 30],
      ['a', 2, 30],
    ])
  })

  it('reports empty and duplicate condition rows', () => {
    expect(
      conditionIssues([
        { key: 'currency', value: ' , ' },
        { key: '', value: 'X' },
        { key: 'currency', value: 'USD' },
      ]).map((i) => [i.index, i.field, i.message.split('.').pop()]),
    ).toEqual([
      [0, 'value', 'valueRequired'],
      [1, 'key', 'keyRequired'],
      [2, 'key', 'duplicate'],
    ])
  })

  it('groups by event prefix and keeps known empty events', () => {
    const groups = groupRules(
      [rule('x', 1, 'fx.gain'), rule('y', 5, 'sales.receivable')],
      ['sales.returns'],
    )
    expect(groups.map((g) => g.group)).toEqual(['sales', 'fx'])
    expect(groups[0]?.events.map((e) => [e.eventKey, e.rules.length])).toEqual([
      ['sales.receivable', 1],
      ['sales.returns', 0],
    ])
  })

  it('converts condition rows both ways', () => {
    const c = rowsToConditions([
      { key: ' currency ', value: 'USD' },
      { key: 'tax_code', value: 'KDV10, KDV1' },
      { key: '', value: 'ignored' },
      { key: 'party_group', value: ' ' },
    ])
    expect(c).toEqual({ currency: 'USD', tax_code: ['KDV10', 'KDV1'] })
    expect(conditionsToRows(c)).toEqual([
      { key: 'currency', value: 'USD' },
      { key: 'tax_code', value: 'KDV10, KDV1' },
    ])
  })
})
