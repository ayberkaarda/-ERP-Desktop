import { describe, expect, it } from 'vitest'

import { fixtureConflict, fixtureConflicts, updateConflict } from '../test/conflictFixtures'
import { conflictChoices, mergedPayload } from './conflicts'

describe('conflict choices', () => {
  const fixtures = fixtureConflicts()

  it('finds a conflict of every code in the contract fixtures', () => {
    expect(new Set(fixtures.map((f) => f.dto.code))).toEqual(
      new Set(['VERSION_CONFLICT', 'DOCUMENT_LOCKED', 'DUPLICATE_RECORD']),
    )
  })

  it.each(fixtureConflicts().map((f) => [`${f.file} ${f.dto.code}`, f.dto] as const))(
    '%s shows only choices the server offered',
    (_name, dto) => {
      const shown = conflictChoices(dto)
      expect(shown.length).toBeGreaterThan(0)
      for (const choice of shown) expect(dto.choices).toContain(choice)
    },
  )

  it('a locked document offers a new draft or discarding, never keep_mine', () => {
    const locked = fixtureConflict('DOCUMENT_LOCKED')
    expect(conflictChoices(locked)).toEqual(['save_as_new_draft', 'discard'])
    expect(conflictChoices({ ...locked, choices: ['keep_mine', 'save_as_new_draft', 'discard'] })).toEqual([
      'save_as_new_draft',
      'discard',
    ])
  })

  it('a duplicate offers the existing record, keeping mine or discarding', () => {
    const duplicate = fixtureConflict('DUPLICATE_RECORD')
    expect(conflictChoices(duplicate)).toEqual(['use_existing', 'keep_mine', 'discard'])
  })

  it('a deleted record has no merge even if one were offered', () => {
    const deleted = fixtureConflict('VERSION_CONFLICT')
    expect(deleted.local_op).toBe('delete')
    expect(conflictChoices(deleted)).toEqual(['keep_mine', 'take_server'])
    expect(conflictChoices({ ...deleted, choices: ['keep_mine', 'take_server', 'merge'] })).toEqual([
      'keep_mine',
      'take_server',
    ])
    expect(conflictChoices({ ...deleted, local_op: 'action', choices: ['merge', 'keep_mine'] })).toEqual([
      'keep_mine',
    ])
  })

  it('an update conflict offers all three, in table order', () => {
    expect(conflictChoices(updateConflict({ choices: ['merge', 'take_server', 'keep_mine'] }))).toEqual([
      'keep_mine',
      'take_server',
      'merge',
    ])
  })

  it('an unknown code shows nothing', () => {
    expect(conflictChoices(updateConflict({ code: 'SOMETHING_ELSE' }))).toEqual([])
  })
})

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
