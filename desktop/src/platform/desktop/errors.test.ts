import { describe, expect, it } from 'vitest'

import { CommandError } from '../../bridge/invoke'
import { commandToApiError, COMMAND_STATUS } from './errors'

// The generated union read as text: a type has no runtime list of its members.
const shellCodeSource = import.meta.glob<string>('../../bridge/generated/ShellErrorCode.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('commandToApiError', () => {
  it('maps every shell code outside the session table to status 0', () => {
    const text = Object.values(shellCodeSource)[0] ?? ''
    const codes = [...text.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1] ?? '')
    expect(codes.length).toBeGreaterThan(20)
    const table: Record<string, number> = { NO_ACTIVE_PROFILE: 401, PAYLOAD_TOO_LARGE: 413 }
    for (const code of codes) {
      expect([code, commandToApiError(new CommandError(code, 'm')).status]).toEqual([code, table[code] ?? 0])
    }
  })

  it('gives a status to the session codes and the payload limit only', () => {
    expect(Object.keys(COMMAND_STATUS).sort()).toEqual([
      'NO_ACTIVE_PROFILE',
      'PASSWORD_CHANGE_REQUIRED',
      'PAYLOAD_TOO_LARGE',
      'UNAUTHENTICATED',
      'USER_DEACTIVATED',
    ])
  })
})
