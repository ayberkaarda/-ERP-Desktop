// Conflict Inbox records built from the sync contract fixtures: every `conflict`
// result in `contracts/sync/fixtures/*.json` becomes the `ConflictDto` the shell
// would list for it, with a local draft that fits the conflict.

import type { ConflictDto } from '../bridge/generated/ConflictDto'

// Read at build time of the test module, so it works in any test environment.
const FIXTURES = import.meta.glob<unknown>('../../../contracts/sync/fixtures/*.json', {
  eager: true,
  import: 'default',
})

interface WireConflict {
  code: string
  message?: string
  base_version: number | null
  server_version: number | null
  conflicting_fields: string[]
  server_data: unknown
  candidates?: string[]
  choices: string[]
}

interface WireResult {
  idempotency_key: string
  resource: string
  id: string
  status: string
  conflict?: WireConflict
}

export interface FixtureConflict {
  file: string
  dto: ConflictDto
}

// The local operation the conflict implies: a locked document was edited, a
// duplicate was created, a version conflict without fields was a delete
// (`exact` rule), one with fields an update.
function localOp(conflict: WireConflict): string {
  if (conflict.code === 'DUPLICATE_RECORD') return 'create'
  if (conflict.code === 'VERSION_CONFLICT' && conflict.conflicting_fields.length === 0) return 'delete'
  return 'update'
}

function localPayload(conflict: WireConflict, op: string): Record<string, unknown> {
  if (op === 'delete') return {}
  const payload: Record<string, unknown> = { notes: 'yerel not' }
  for (const field of conflict.conflicting_fields) payload[field] = `yerel ${field}`
  return payload
}

export function fixtureConflicts(): FixtureConflict[] {
  const found: FixtureConflict[] = []
  for (const [path, json] of Object.entries(FIXTURES).sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.slice(path.lastIndexOf('/') + 1)
    const body = json as { data?: { results?: WireResult[] } }
    for (const result of body.data?.results ?? []) {
      if (result.status !== 'conflict' || !result.conflict) continue
      const c = result.conflict
      const op = localOp(c)
      found.push({
        file,
        dto: {
          idempotency_key: result.idempotency_key,
          resource: result.resource,
          id: result.id,
          code: c.code,
          message: c.message ?? null,
          base_version: c.base_version,
          server_version: c.server_version,
          conflicting_fields: c.conflicting_fields,
          server_data: c.server_data,
          candidates: c.candidates ?? null,
          choices: c.choices,
          local_op: op,
          local_payload: localPayload(c, op),
          detected_at: '2026-10-26T09:15:05Z',
        },
      })
    }
  }
  return found
}

/** The first fixture conflict with `code`. */
export function fixtureConflict(code: string): ConflictDto {
  const found = fixtureConflicts().find((f) => f.dto.code === code)
  if (!found) throw new Error(`no ${code} conflict in the fixtures`)
  return found.dto
}

/** An update that clashed on two fields; the server offers all three choices. */
export function updateConflict(overrides: Partial<ConflictDto> = {}): ConflictDto {
  return {
    idempotency_key: '0193b1f0-1111-7aaa-8bbb-0000000000f1',
    resource: 'sales-quotes',
    id: '0193b1e5-0c11-7a22-9b33-4c5d6e7f8a99',
    code: 'VERSION_CONFLICT',
    message: null,
    base_version: 2,
    server_version: 4,
    conflicting_fields: ['notes', 'valid_until'],
    server_data: { id: 'x', notes: 'sunucu notu', valid_until: '2026-12-01', version: 4 },
    candidates: null,
    choices: ['keep_mine', 'take_server', 'merge'],
    local_op: 'update',
    local_payload: { notes: 'yerel not', valid_until: '2026-11-30', internal_notes: 'iç not' },
    detected_at: '2026-10-26T09:15:05Z',
    ...overrides,
  }
}
