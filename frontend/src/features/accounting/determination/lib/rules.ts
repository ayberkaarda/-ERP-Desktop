import type { DeterminationRule, RuleConditions } from '../../shared/types'

/** Event keys group by their first segment ("sales.vat_output" -> "sales"). */
export function eventGroup(eventKey: string): string {
  return eventKey.split('.')[0] ?? eventKey
}

export const GROUP_ORDER = ['sales', 'purchase', 'inventory', 'treasury', 'fx', 'payroll']

export function compareGroups(a: string, b: string): number {
  const ia = GROUP_ORDER.indexOf(a)
  const ib = GROUP_ORDER.indexOf(b)
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  return a.localeCompare(b)
}

/** Highest priority first (the resolver tries rules in this order); stable by id. */
export function sortRules(rules: readonly DeterminationRule[]): DeterminationRule[] {
  return [...rules].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
}

export interface EventBlock {
  eventKey: string
  rules: DeterminationRule[]
}

export interface GroupBlock {
  group: string
  events: EventBlock[]
}

/** Rules arranged as group -> event key -> rules by priority; known events show even when empty. */
export function groupRules(
  rules: readonly DeterminationRule[],
  knownEvents: readonly string[],
): GroupBlock[] {
  const byEvent = new Map<string, DeterminationRule[]>()
  for (const e of knownEvents) byEvent.set(e, [])
  for (const r of rules) {
    const list = byEvent.get(r.event_key) ?? []
    list.push(r)
    byEvent.set(r.event_key, list)
  }
  const groups = new Map<string, EventBlock[]>()
  for (const [eventKey, list] of byEvent) {
    const g = eventGroup(eventKey)
    const events = groups.get(g) ?? []
    events.push({ eventKey, rules: sortRules(list) })
    groups.set(g, events)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareGroups(a, b))
    .map(([group, events]) => ({
      group,
      events: events.sort((a, b) => a.eventKey.localeCompare(b.eventKey)),
    }))
}

export function isDefaultRule(rule: Pick<DeterminationRule, 'conditions'>): boolean {
  return !rule.conditions || Object.keys(rule.conditions).length === 0
}

export interface PriorityChange {
  rule: DeterminationRule
  priority: number
}

/**
 * Priority edits that move `rule` exactly one place up or down among `ordered` (highest first)
 * and keep every other rule's relative order. Distinct neighbours swap priorities. A run of equal
 * priorities is renumbered (within the room the neighbouring priorities leave; otherwise the
 * whole group is respaced) so the moved rule lands right next to its old neighbour.
 * Returns only rules whose priority changes; [] when the move is not possible.
 */
export function movePriority(
  ordered: readonly DeterminationRule[],
  ruleId: string,
  direction: 'up' | 'down',
): PriorityChange[] {
  const i = ordered.findIndex((r) => r.id === ruleId)
  const j = direction === 'up' ? i - 1 : i + 1
  const a = ordered[i]
  const b = ordered[j]
  if (i < 0 || !a || !b) return []
  if (a.priority !== b.priority) {
    return [
      { rule: a, priority: b.priority },
      { rule: b, priority: a.priority },
    ]
  }
  const next = [...ordered]
  next[i] = b
  next[j] = a
  const p = a.priority
  const first = next.findIndex((r) => r.priority === p)
  let last = first
  while (next[last + 1]?.priority === p) last += 1
  const run = next.slice(first, last + 1)
  const upper = ordered[first - 1]?.priority ?? Number.POSITIVE_INFINITY
  const lower = ordered[last + 1]?.priority ?? Number.NEGATIVE_INFINITY
  const m = run.length
  let target: number[]
  if (p + m - 1 < upper) target = run.map((_, k) => p + m - 1 - k)
  else if (p - m + 1 > lower) target = run.map((_, k) => p - k)
  else {
    // No integer room between the neighbours: respace the whole event group by tens.
    const base = Math.min(...ordered.map((r) => r.priority))
    return changesFor(
      next,
      next.map((_, k) => base + (next.length - 1 - k) * 10),
    )
  }
  return changesFor(run, target)
}

function changesFor(rules: readonly DeterminationRule[], priorities: readonly number[]) {
  const out: PriorityChange[] = []
  rules.forEach((rule, k) => {
    const priority = priorities[k]
    if (priority !== undefined && priority !== rule.priority) out.push({ rule, priority })
  })
  return out
}

/** A reorder failed; `rolledBack` tells whether earlier edits were undone. */
export class PriorityMoveError extends Error {
  override readonly cause: unknown
  readonly rolledBack: boolean
  constructor(cause: unknown, rolledBack: boolean) {
    super('Priority move failed')
    this.name = 'PriorityMoveError'
    this.cause = cause
    this.rolledBack = rolledBack
  }
}

/**
 * Applies the edits one by one (the API has no bulk reorder). If one fails, the edits already
 * applied are reverted in reverse order with their new versions, so the order is not left half
 * changed; the caller reloads either way.
 */
export async function applyPriorityChanges(
  changes: readonly PriorityChange[],
  update: (id: string, version: number, priority: number) => Promise<DeterminationRule>,
): Promise<void> {
  const applied: { before: DeterminationRule; after: DeterminationRule }[] = []
  try {
    for (const c of changes) {
      const after = await update(c.rule.id, c.rule.version, c.priority)
      applied.push({ before: c.rule, after })
    }
  } catch (error) {
    let rolledBack = true
    for (const { before, after } of [...applied].reverse()) {
      try {
        await update(after.id, after.version, before.priority)
      } catch {
        rolledBack = false
      }
    }
    throw new PriorityMoveError(error, rolledBack)
  }
}

export interface ConditionRow {
  key: string
  value: string
}

/** Form rows -> API conditions; comma-separated values become a list ("any of"). */
export function rowsToConditions(rows: readonly ConditionRow[]): RuleConditions {
  const out: RuleConditions = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    const parts = row.value
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length === 0) continue
    const [first] = parts
    out[key] = parts.length === 1 && first !== undefined ? first : parts
  }
  return out
}

export function conditionsToRows(conditions: RuleConditions | null | undefined): ConditionRow[] {
  return Object.entries(conditions ?? {}).map(([key, value]) => ({
    key,
    value: Array.isArray(value) ? value.join(', ') : value,
  }))
}

/** Free-text filter over event key, account and description (Turkish case rules). */
export function ruleMatches(rule: DeterminationRule, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase('tr')
  if (!needle) return true
  return [
    rule.event_key,
    rule.account?.code,
    rule.account?.name,
    rule.description,
    ...Object.values(rule.conditions ?? {}).flat(),
  ]
    .filter((x): x is string => typeof x === 'string')
    .some((x) => x.toLocaleLowerCase('tr').includes(needle))
}

export interface ConditionIssue {
  index: number
  field: 'key' | 'value'
  /** i18n key in the accounting namespace. */
  message: string
}

const splitValues = (value: string) =>
  value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)

/**
 * Problems that would change a rule's meaning on save: a row without key or without any value
 * (it would be dropped and the rule could become unconditional) and repeated keys.
 */
export function conditionIssues(rows: readonly ConditionRow[]): ConditionIssue[] {
  const issues: ConditionIssue[] = []
  const seen = new Map<string, number>()
  rows.forEach((row, index) => {
    const key = row.key.trim()
    if (!key)
      issues.push({ index, field: 'key', message: 'determination.conditions.errors.keyRequired' })
    if (splitValues(row.value).length === 0)
      issues.push({
        index,
        field: 'value',
        message: 'determination.conditions.errors.valueRequired',
      })
    if (key) {
      if (seen.has(key))
        issues.push({ index, field: 'key', message: 'determination.conditions.errors.duplicate' })
      else seen.set(key, index)
    }
  })
  return issues
}
