import { describe, expect, it } from 'vitest'

import { updateConflict } from '../test/conflictFixtures'
import { mergedPayload } from './conflicts'

describe('merged payload', () => {
  it('keeps my value of the fields I chose and leaves the rest to the server', () => {
    const conflict = updateConflict()
    expect(mergedPayload(conflict, { notes: 'mine', valid_until: 'server' })).toEqual({
      notes: 'yerel not',
      internal_notes: 'iç not',
    })
  })

  it('takes my value of a conflicting field nobody chose for', () => {
    expect(mergedPayload(updateConflict(), {})).toEqual({
      notes: 'yerel not',
      valid_until: '2026-11-30',
      internal_notes: 'iç not',
    })
  })

  it('never sends a version', () => {
    const conflict = updateConflict({ local_payload: { notes: 'n', version: 2 } })
    expect(mergedPayload(conflict, {})).toEqual({ notes: 'n' })
  })

  it('is empty when every field went to the server', () => {
    const conflict = updateConflict({ local_payload: { notes: 'n' }, conflicting_fields: ['notes'] })
    expect(mergedPayload(conflict, { notes: 'server' })).toEqual({})
  })
})
