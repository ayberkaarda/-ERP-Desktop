// Merge payload of the Conflict Inbox. Which choices a record shows comes from
// the wire package's `conflictModel` (protocol table, server choices, merge
// only for an update).

import type { ConflictDto } from '../bridge/generated/ConflictDto'

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
