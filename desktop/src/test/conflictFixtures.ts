// A Conflict Inbox record for the merge tests. The contract fixture conflicts
// come from the wire package (`conflictDtoFixtures`).

import type { ConflictDto } from '../bridge/generated/ConflictDto'

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
