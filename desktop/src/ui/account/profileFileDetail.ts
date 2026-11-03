// The shell's PROFILES_FILE_INVALID message (src-tauri/src/profiles.rs) in the
// user's language. The shell writes a few fixed English sentences and
// "cannot <what> the profile file: <io error kind>"; anything else is shown
// as it came.

import type { Td } from '../../i18n'

const FIXED: Readonly<Record<string, 'invalid' | 'version' | 'encode'>> = {
  'the profile file is not valid JSON of this version': 'invalid',
  'the profile file has an unknown version': 'version',
  'cannot encode': 'encode',
}

const IO = /^cannot (read|write|replace|create the directory of) the profile file: (.+)$/

const VERB = {
  read: 'read',
  write: 'write',
  replace: 'replace',
  'create the directory of': 'directory',
} as const

function cause(td: Td, kind: string): string {
  if (kind === 'permission denied') return td('account.recovery.file.cause.permission')
  if (kind === 'entity not found' || kind === 'not found') return td('account.recovery.file.cause.notFound')
  return td('account.recovery.file.cause.other', { kind })
}

export function profileFileDetail(td: Td, message: string): string {
  const fixed = Object.hasOwn(FIXED, message) ? FIXED[message] : undefined
  if (fixed) return td(`account.recovery.file.reason.${fixed}`)
  const io = IO.exec(message)
  const verb = io?.[1]
  const kind = io?.[2]
  if (verb && kind && Object.hasOwn(VERB, verb)) {
    return td(`account.recovery.file.reason.${VERB[verb as keyof typeof VERB]}`, { cause: cause(td, kind) })
  }
  return message
}
