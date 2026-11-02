// The contracts/sync fixture set (the same files the PHP and Rust suites read),
// compiled into generated/fixtures.ts so tests in the window's environment
// need no file access. Nothing in the app imports this; tests do.

import { FIXTURE_SCHEMAS, INVALID_FIXTURES, VALID_FIXTURES } from './generated/fixtures'
import { conflictDtoFromWire, isConflictResult, type ConflictResult, type MutationOp } from './conflicts'
import type { ConflictDto } from '../bridge/generated/ConflictDto'
import type { PushRequest } from './generated/push.request'
import type { PushResponse } from './generated/push.response'

export type ValidFixtures = typeof VALID_FIXTURES
export type ValidFixtureName = keyof ValidFixtures

export interface WireFixture {
  /** Path under contracts/sync/fixtures, e.g. "invalid/push.response.locked-with-keep-mine.json". */
  name: string
  /** Schema path under contracts/sync ("../offline-manifest.schema.json" for the manifest). */
  schema: string
  valid: boolean
  data: unknown
}

/** Every fixture, valid and invalid, in file order. Built on call: a window bundle that never calls it drops the data. */
export function wireFixtures(): WireFixture[] {
  return Object.entries(FIXTURE_SCHEMAS).map(([name, schema]) => {
    const valid = !name.startsWith('invalid/')
    const data: unknown = valid ? VALID_FIXTURES[name as ValidFixtureName] : INVALID_FIXTURES[name]
    return { name, schema, valid, data: structuredClone(data) }
  })
}

/** A valid fixture with its schema type. A deep copy: tests may change it. */
export function validFixture<N extends ValidFixtureName>(name: N): ValidFixtures[N] {
  return structuredClone(VALID_FIXTURES[name])
}

/** Any fixture by path; throws on an unknown one. */
export function wireFixture(name: string): WireFixture {
  const found = wireFixtures().find((fixture) => fixture.name === name)
  if (found === undefined) throw new Error(`no fixture ${name}`)
  return found
}

export interface ConflictFixture {
  /** The push response fixture the result comes from. */
  fixture: string
  result: ConflictResult
  /** The operation of the mutation, when push.request.outbox-batch.json carries it. */
  op?: MutationOp
}

function opsByKey(): Map<string, MutationOp> {
  const request: PushRequest = VALID_FIXTURES['push.request.outbox-batch.json']
  return new Map(request.mutations.map((m) => [m.idempotency_key, m.op]))
}

/** Every valid fixture of push.response.schema.json (each `satisfies PushResponse`). */
function pushResponseFixtures(): string[] {
  return Object.entries(FIXTURE_SCHEMAS)
    .filter(([name, schema]) => schema === 'push.response.schema.json' && !name.startsWith('invalid/'))
    .map(([name]) => name)
}

/** Every `conflict` result of the valid push response fixtures. */
export function conflictFixtures(): ConflictFixture[] {
  const ops = opsByKey()
  return pushResponseFixtures().flatMap((fixture) => {
    const response = validFixture(fixture as ValidFixtureName) as PushResponse
    return response.data.results.filter(isConflictResult).map((result) => {
      const op = ops.get(result.idempotency_key)
      return op === undefined ? { fixture, result } : { fixture, result, op }
    })
  })
}

/**
 * ConflictDto rows as `conflicts_list` would return them for the fixture
 * conflicts. `op` fills in a draft operation the fixtures do not carry.
 */
export function conflictDtoFixtures(fallbackOp: MutationOp = 'update'): ConflictDto[] {
  return conflictFixtures().map(({ result, op }) =>
    conflictDtoFromWire(result, {
      op: op ?? fallbackOp,
      payload: {},
      detected_at: '2026-10-26T09:15:01Z',
    }),
  )
}
