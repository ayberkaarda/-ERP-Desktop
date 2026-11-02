// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, expectTypeOf, it } from 'vitest'

import type { ConflictDto } from '../bridge/generated/ConflictDto'
import {
  RESOLUTION_TABLE,
  conflictDtoFromWire,
  conflictModel,
  isConflictResult,
  type ConflictInput,
  type ConflictResult,
} from './conflicts'
import { conflictDtoFixtures, conflictFixtures, wireFixture } from './fixtures'
import type { Conflict, PushResponse } from './generated/push.response'

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url))

interface ChoiceRule {
  if: { properties: { code: { const: string } } }
  then: { properties: { choices: { items: { enum: string[] } } } }
}
const pushSchema = JSON.parse(readFileSync(repo('contracts/sync/push.response.schema.json'), 'utf8')) as {
  $defs: { conflict: { allOf: ChoiceRule[] } }
}

// Per code choices of the contract (push.response.schema.json, conflict.allOf).
const schemaTable = Object.fromEntries(
  pushSchema.$defs.conflict.allOf.map((rule) => [
    rule.if.properties.code.const,
    [...rule.then.properties.choices.items.enum].sort(),
  ]),
)

// "| `CODE` | `choice` | ..." rows of the resolution table in docs/SYNC-PROTOCOL.md.
const protocolRows = [
  ...readFileSync(repo('docs/SYNC-PROTOCOL.md'), 'utf8').matchAll(/^\| `([A-Z_]+)` \| `([a-z_]+)` \|/gm),
].map(([, code, choice]) => [code, choice] as const)

const base = (overrides: Partial<ConflictInput>): ConflictInput => ({
  code: 'VERSION_CONFLICT',
  choices: ['keep_mine', 'take_server', 'merge'],
  conflicting_fields: ['notes'],
  server_data: { id: 'x', version: 3, notes: 'server' },
  local_op: 'update',
  ...overrides,
})

describe('resolution table', () => {
  it('is the per code choice list of the push response schema', () => {
    expect(
      Object.fromEntries(Object.entries(RESOLUTION_TABLE).map(([code, choices]) => [code, [...choices].sort()])),
    ).toEqual(schemaTable)
  })

  it('has every code and choice row of the SYNC-PROTOCOL resolution table', () => {
    expect(protocolRows.length).toBeGreaterThanOrEqual(6)
    for (const [code, choice] of protocolRows) {
      expect(RESOLUTION_TABLE[code as keyof typeof RESOLUTION_TABLE]).toContain(choice)
    }
  })
})

describe('conflictModel on the fixture conflicts', () => {
  it('finds a conflict of every code in the fixtures', () => {
    expect(new Set(conflictFixtures().map(({ result }) => result.conflict.code))).toEqual(
      new Set(Object.keys(RESOLUTION_TABLE)),
    )
  })

  it.each(conflictFixtures().map((c) => [c.fixture, c.result.idempotency_key, c] as const))(
    '%s %s shows exactly the offered choices',
    (_fixture, _key, { result, op }) => {
      const outcome = conflictModel({ ...result.conflict, local_op: op ?? 'update' })
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect([...outcome.model.choices].sort()).toEqual([...result.conflict.choices].sort())
      expect(outcome.model.code).toBe(result.conflict.code)
    },
  )

  it('keeps the table order and the code specific fields', () => {
    const models = conflictDtoFixtures().map((dto) => conflictModel(dto))
    expect(models).toEqual([
      {
        ok: true,
        model: {
          code: 'DOCUMENT_LOCKED',
          choices: ['save_as_new_draft', 'discard'],
          server: expect.objectContaining({ status: 'confirmed', version: 6 }) as unknown,
        },
      },
      {
        ok: true,
        model: {
          code: 'DUPLICATE_RECORD',
          choices: ['use_existing', 'keep_mine', 'discard'],
          candidates: ['0193b1e4-2a7c-7d55-b8e9-3f4a5b6c7d10'],
        },
      },
      {
        ok: true,
        model: {
          code: 'VERSION_CONFLICT',
          choices: ['keep_mine', 'take_server'],
          fields: [],
          server: expect.objectContaining({ id: '0193b1e9-1200-7e40-9444-8b9c0d1e2f71', version: 3 }) as unknown,
        },
      },
    ])
  })

  it('refuses invalid/push.response.locked-with-keep-mine.json, like the schema', () => {
    const response = wireFixture('invalid/push.response.locked-with-keep-mine.json').data as PushResponse
    const [result] = response.data.results
    expect(result && isConflictResult(result)).toBe(true)
    if (!result?.conflict) return
    expect(conflictModel({ ...result.conflict, local_op: 'update' })).toEqual({
      ok: false,
      reason: 'choice_not_allowed',
      detail: 'DOCUMENT_LOCKED: keep_mine',
    })
  })

  it('finds no conflict in invalid/push.response.conflict-without-detail.json', () => {
    const response = wireFixture('invalid/push.response.conflict-without-detail.json').data as PushResponse
    expect(response.data.results.filter(isConflictResult)).toEqual([])
  })
})

describe('conflictModel rules', () => {
  it('offers merge for an update only (delete and action have none)', () => {
    expect(conflictModel(base({})).ok).toBe(true)
    for (const op of ['delete', 'action', 'create']) {
      expect(conflictModel(base({ local_op: op }))).toMatchObject({ ok: false, reason: 'merge_needs_update' })
      expect(conflictModel(base({ local_op: op, choices: ['keep_mine', 'take_server'] }))).toMatchObject({
        ok: true,
        model: { choices: ['keep_mine', 'take_server'] },
      })
    }
  })

  it('lists the choices in table order, whatever order the server sends', () => {
    expect(conflictModel(base({ choices: ['merge', 'take_server', 'keep_mine'] }))).toMatchObject({
      ok: true,
      model: { choices: ['keep_mine', 'take_server', 'merge'] },
    })
    expect(
      conflictModel(
        base({ code: 'DUPLICATE_RECORD', choices: ['discard', 'use_existing'], server_data: null, candidates: ['c1'] }),
      ),
    ).toMatchObject({ ok: true, model: { choices: ['use_existing', 'discard'] } })
    expect(
      conflictModel(base({ code: 'DOCUMENT_LOCKED', choices: ['discard', 'save_as_new_draft'] })),
    ).toMatchObject({ ok: true, model: { choices: ['save_as_new_draft', 'discard'] } })
  })

  it('hands the conflicting fields and the server row to a version conflict', () => {
    const outcome = conflictModel(base({ conflicting_fields: ['notes', 'lines'] }))
    expect(outcome).toEqual({
      ok: true,
      model: {
        code: 'VERSION_CONFLICT',
        choices: ['keep_mine', 'take_server', 'merge'],
        fields: ['notes', 'lines'],
        server: { id: 'x', version: 3, notes: 'server' },
      },
    })
  })

  it.each([
    [{ code: 'DOCUMENT_LOCKED', choices: ['discard', 'keep_mine'] }, 'DOCUMENT_LOCKED: keep_mine'],
    [{ code: 'DOCUMENT_LOCKED', choices: ['save_as_new_draft', 'discard', 'take_server'] }, 'DOCUMENT_LOCKED: take_server'],
    [{ code: 'VERSION_CONFLICT', choices: ['keep_mine', 'take_server', 'discard'] }, 'VERSION_CONFLICT: discard'],
    [
      { code: 'DUPLICATE_RECORD', choices: ['use_existing', 'keep_mine', 'merge'], server_data: null, candidates: ['c1'] },
      'DUPLICATE_RECORD: merge',
    ],
  ] as const)('refuses %j: a disallowed choice after allowed ones', (overrides, detail) => {
    expect(conflictModel(base(overrides))).toEqual({ ok: false, reason: 'choice_not_allowed', detail })
  })

  it('never shows a choice the server did not offer', () => {
    expect(conflictModel(base({ choices: ['take_server'] }))).toMatchObject({
      ok: true,
      model: { choices: ['take_server'] },
    })
  })

  it.each([
    [{ code: 'VERSION_CONFLICT', choices: ['discard'] }, 'choice_not_allowed'],
    [{ code: 'VERSION_CONFLICT', choices: ['use_existing'] }, 'choice_not_allowed'],
    [{ code: 'DOCUMENT_LOCKED', choices: ['take_server'] }, 'choice_not_allowed'],
    [{ code: 'DUPLICATE_RECORD', choices: ['merge'] }, 'choice_not_allowed'],
    [{ code: 'DUPLICATE_RECORD', choices: ['save_as_new_draft'] }, 'choice_not_allowed'],
    [{ code: 'VERSION_CONFLICT', choices: [] }, 'no_choices'],
    [{ code: 'STALE', choices: ['discard'] }, 'unknown_code'],
    [{ local_op: 'upsert' }, 'unknown_op'],
    [{ server_data: null }, 'server_data_missing'],
    [{ code: 'DOCUMENT_LOCKED', choices: ['discard'], server_data: [] }, 'server_data_missing'],
    [{ code: 'DUPLICATE_RECORD', choices: ['discard'], server_data: null, candidates: null }, 'candidates_missing'],
    [{ code: 'DUPLICATE_RECORD', choices: ['discard'], server_data: null, candidates: [] }, 'candidates_missing'],
  ] as const)('refuses %j: %s', (overrides, reason) => {
    expect(conflictModel(base(overrides))).toMatchObject({ ok: false, reason })
  })
})

describe('wire conflict -> ConflictDto', () => {
  it.each(conflictFixtures().map((c) => [c.result.conflict.code, c] as const))(
    'maps every wire conflict field of the %s fixture to the ConflictDto field of the same name',
    (_code, { result }) => {
      const dto = conflictDtoFromWire(result, { op: 'update', payload: {}, detected_at: 'now' })
      for (const field of Object.keys(result.conflict)) {
        expect(dto[field as keyof ConflictDto], field).toEqual(result.conflict[field as keyof Conflict])
      }
    },
  )

  it('keeps base_version and server_version apart', () => {
    const locked = conflictFixtures().find((c) => c.result.conflict.code === 'DOCUMENT_LOCKED')
    const version = conflictFixtures().find((c) => c.result.conflict.code === 'VERSION_CONFLICT')
    if (locked === undefined || version === undefined) throw new Error('missing fixture')
    expect(locked.result.conflict).toMatchObject({ base_version: 4, server_version: 6 })
    expect(conflictDtoFromWire(locked.result, { op: 'update', payload: {}, detected_at: 'now' })).toMatchObject({
      base_version: 4,
      server_version: 6,
    })
    const v = version.result.conflict
    expect(v.base_version).not.toBe(v.server_version)
    expect(conflictDtoFromWire(version.result, { op: 'delete', payload: {}, detected_at: 'now' })).toMatchObject({
      base_version: v.base_version,
      server_version: v.server_version,
    })
    // A synthetic one, so the check does not depend on the fixture values.
    const synthetic: ConflictResult = {
      ...version.result,
      conflict: { ...v, base_version: 11, server_version: 17 },
    }
    expect(conflictDtoFromWire(synthetic, { op: 'update', payload: {}, detected_at: 'now' })).toMatchObject({
      base_version: 11,
      server_version: 17,
    })
  })

  it('maps the wire conflict of the duplicate fixture with the draft side', () => {
    const [{ result } = { result: undefined }] = conflictFixtures().filter(
      (c) => c.result.conflict.code === 'DUPLICATE_RECORD',
    )
    if (result === undefined) throw new Error('no duplicate fixture')
    const dto = conflictDtoFromWire(result, { op: 'create', payload: { name: 'x' }, detected_at: 'now' })
    for (const field of Object.keys(result.conflict)) {
      if (field === 'code' || field === 'choices') continue
      expect(dto[field as keyof ConflictDto], field).toEqual(result.conflict[field as keyof Conflict])
    }
    expect(dto).toMatchObject({
      idempotency_key: result.idempotency_key,
      resource: 'parties',
      id: result.id,
      code: 'DUPLICATE_RECORD',
      choices: ['use_existing', 'keep_mine', 'discard'],
      message: null,
      local_op: 'create',
      local_payload: { name: 'x' },
      detected_at: 'now',
    })
  })

  it('gives null for a missing message and candidates', () => {
    const locked = conflictFixtures().find((c) => c.result.conflict.code === 'DOCUMENT_LOCKED')
    if (locked === undefined) throw new Error('no locked fixture')
    const dto = conflictDtoFromWire(locked.result, { op: 'update', payload: {}, detected_at: 'now' })
    expect(dto.candidates).toBeNull()
    expect(dto.message).toBe('Sipariş onaylandığı için değiştirilemez.')
  })

  it('has the ConflictDto fields for every wire conflict field (types)', () => {
    expectTypeOf<Exclude<keyof Conflict, keyof ConflictDto>>().toEqualTypeOf<never>()
    expectTypeOf<Pick<Conflict, 'base_version' | 'server_version' | 'conflicting_fields'>>().toExtend<
      Pick<ConflictDto, 'base_version' | 'server_version' | 'conflicting_fields'>
    >()
    expectTypeOf<ConflictDto>().toExtend<ConflictInput>()
    expectTypeOf<ConflictResult['conflict']>().toEqualTypeOf<Conflict>()
  })
})
