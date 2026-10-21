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
 * Priority edits that move `rule` one place up or down among `ordered` (highest first): the two
 * rules swap priorities; equal priorities are split so the order is unambiguous afterwards.
 * Returns [] when the move is not possible.
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
  // Same priority: lift (or drop) only the moved rule past its neighbour.
  return [{ rule: a, priority: direction === 'up' ? b.priority + 1 : b.priority - 1 }]
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
