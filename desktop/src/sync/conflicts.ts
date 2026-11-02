// Conflict Inbox model: which choices a record may show and the merged payload.
// Choices come only from the record's own `choices` (what the server offered),
// narrowed by the protocol's resolution table, so a choice the server or the
// protocol does not allow is never shown (docs/SYNC-PROTOCOL.md, conflicts).

import type { ConflictDto } from '../bridge/generated/ConflictDto'

export type ConflictChoice =
  | 'keep_mine'
  | 'take_server'
  | 'merge'
  | 'save_as_new_draft'
  | 'discard'
  | 'use_existing'

/** Protocol resolution table, in display order. */
const ALLOWED: Readonly<Record<string, readonly ConflictChoice[]>> = {
  VERSION_CONFLICT: ['keep_mine', 'take_server', 'merge'],
  DOCUMENT_LOCKED: ['save_as_new_draft', 'discard'],
  DUPLICATE_RECORD: ['use_existing', 'keep_mine', 'discard'],
}

export function conflictChoices(conflict: ConflictDto): ConflictChoice[] {
  const offered = new Set(conflict.choices)
  return (ALLOWED[conflict.code] ?? []).filter(
    // A merge rewrites an update's fields; a delete or an action has none.
    (choice) => offered.has(choice) && (choice !== 'merge' || conflict.local_op === 'update'),
  )
}

export type FieldPick = 'mine' | 'server'

/**
 * The update a merge sends: the local draft's fields, without the conflicting
 * fields the user left to the server (and never `version`). Empty when nothing
 * of the draft is left to send.
 */
export function mergedPayload(
  conflict: ConflictDto,
  picks: Readonly<Record<string, FieldPick>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  const conflicting = new Set(conflict.conflicting_fields)
  for (const [field, value] of Object.entries(conflict.local_payload)) {
    if (field === 'version') continue
    if (conflicting.has(field) && (picks[field] ?? 'mine') === 'server') continue
    merged[field] = value
  }
  return merged
}

/** The server row's value of `field`, `undefined` when the row is missing. */
export function serverValue(conflict: ConflictDto, field: string): unknown {
  const row = conflict.server_data
  return typeof row === 'object' && row !== null ? (row as Record<string, unknown>)[field] : undefined
}
