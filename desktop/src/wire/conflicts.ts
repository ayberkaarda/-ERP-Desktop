// Conflict Inbox choice model: what a conflict (push `conflict` result or the
// shell's ConflictDto) lets the user do, by the resolution table of
// docs/SYNC-PROTOCOL.md ("Çakışma kuralları", "Çakışma çözümü") and the
// checks of keystone-sync `conflicts::decide` (choice offered by the server
// and allowed for the code; merge only for an update).

import type { ConflictDto } from '../bridge/generated/ConflictDto'
import type { Mutation } from './generated/push.request'
import type { Conflict, Result } from './generated/push.response'

export type ConflictCode = Conflict['code']
export type ConflictChoice = Conflict['choices'][number]
export type MutationOp = Mutation['op']

/** Choices each code allows (keystone-sync `allowed_choices`), in display order. */
export const RESOLUTION_TABLE: Readonly<Record<ConflictCode, readonly ConflictChoice[]>> = {
  VERSION_CONFLICT: ['keep_mine', 'take_server', 'merge'],
  DOCUMENT_LOCKED: ['save_as_new_draft', 'discard'],
  DUPLICATE_RECORD: ['use_existing', 'keep_mine', 'discard'],
}

/** The fields the model reads; a wire `Conflict` plus `local_op`, or a ConflictDto. */
export interface ConflictInput {
  code: string
  choices: readonly string[]
  conflicting_fields: readonly string[]
  server_data: unknown
  candidates?: readonly string[] | null
  local_op: string
}

interface ModelBase {
  /** Allowed by the protocol and offered by the server, in table order. */
  choices: readonly ConflictChoice[]
}

export type ConflictModel =
  | (ModelBase & {
      code: 'VERSION_CONFLICT'
      /** Fields changed on both sides; a merge picks a side for each. */
      fields: readonly string[]
      server: Record<string, unknown>
    })
  | (ModelBase & { code: 'DOCUMENT_LOCKED'; server: Record<string, unknown> })
  | (ModelBase & { code: 'DUPLICATE_RECORD'; candidates: readonly string[] })

export type ConflictRefusal =
  | 'unknown_code'
  | 'unknown_op'
  | 'choice_not_allowed'
  | 'merge_needs_update'
  | 'no_choices'
  | 'server_data_missing'
  | 'candidates_missing'

export type ConflictModelResult =
  | { ok: true; model: ConflictModel }
  | { ok: false; reason: ConflictRefusal; detail: string }

const OPS: readonly string[] = ['create', 'update', 'delete', 'action'] satisfies MutationOp[]

const isCode = (code: string): code is ConflictCode => Object.hasOwn(RESOLUTION_TABLE, code)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const refuse = (reason: ConflictRefusal, detail: string): ConflictModelResult => ({ ok: false, reason, detail })

/**
 * The choices to show for a conflict, or why it cannot be shown. A choice the
 * server offers outside the table (e.g. `keep_mine` on DOCUMENT_LOCKED) refuses
 * the whole record: the server and this client disagree on the protocol.
 */
export function conflictModel(input: ConflictInput): ConflictModelResult {
  const { code } = input
  if (!isCode(code)) return refuse('unknown_code', code)
  if (!OPS.includes(input.local_op)) return refuse('unknown_op', input.local_op)
  const allowed = RESOLUTION_TABLE[code]
  const offered = new Set(input.choices)
  for (const choice of offered) {
    if (!(allowed as readonly string[]).includes(choice)) return refuse('choice_not_allowed', `${code}: ${choice}`)
  }
  if (offered.has('merge') && input.local_op !== 'update') {
    return refuse('merge_needs_update', `${code}: merge for ${input.local_op}`)
  }
  const choices = allowed.filter((choice) => offered.has(choice))
  if (choices.length === 0) return refuse('no_choices', code)
  switch (code) {
    case 'VERSION_CONFLICT':
    case 'DOCUMENT_LOCKED': {
      if (!isRecord(input.server_data)) return refuse('server_data_missing', code)
      return code === 'VERSION_CONFLICT'
        ? { ok: true, model: { code, choices, fields: input.conflicting_fields, server: input.server_data } }
        : { ok: true, model: { code, choices, server: input.server_data } }
    }
    case 'DUPLICATE_RECORD': {
      const candidates = input.candidates ?? []
      if (candidates.length === 0) return refuse('candidates_missing', code)
      return { ok: true, model: { code, choices, candidates } }
    }
  }
}

/** The local side of a conflict: the outbox draft that met it. */
export interface LocalDraft {
  op: MutationOp
  payload: Record<string, unknown>
  detected_at: string
}

export type ConflictResult = Result & { status: 'conflict'; conflict: Conflict }

export function isConflictResult(result: Result): result is ConflictResult {
  return result.status === 'conflict' && result.conflict !== undefined
}

/**
 * The ConflictDto the shell lists for a push `conflict` result, field for
 * field (keystone-sync stores the wire conflict as it came). For tests and
 * fixtures: the window gets ConflictDto from `conflicts_list`.
 */
export function conflictDtoFromWire(result: ConflictResult, local: LocalDraft): ConflictDto {
  const { conflict } = result
  return {
    idempotency_key: result.idempotency_key,
    resource: result.resource,
    id: result.id,
    code: conflict.code,
    message: conflict.message ?? null,
    base_version: conflict.base_version,
    server_version: conflict.server_version,
    conflicting_fields: [...conflict.conflicting_fields],
    server_data: conflict.server_data,
    candidates: conflict.candidates === undefined ? null : [...conflict.candidates],
    choices: [...conflict.choices],
    local_op: local.op,
    local_payload: local.payload,
    detected_at: local.detected_at,
  }
}
