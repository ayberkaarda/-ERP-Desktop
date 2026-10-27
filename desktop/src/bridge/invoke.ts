// Typed door to Tauri commands. `invoke` is passed in (the real one from
// `@tauri-apps/api/core`, or a stub in tests); every failure leaves here as a
// `CommandError`, whatever the shell or Tauri rejected with.

import type { CommandError as CommandErrorBody } from './generated/CommandError'

export type { CommandErrorBody }

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

/** A failed command: `code` is the stable key the UI looks up. */
export class CommandError extends Error {
  readonly code: string
  /** Whole seconds to wait before retrying, when the server said so. */
  readonly retryAfter: number | undefined

  constructor(code: string, message: string, retryAfter?: number) {
    super(message)
    this.name = 'CommandError'
    this.code = code
    this.retryAfter = retryAfter
  }
}

/** Any rejection value becomes a `CommandError` (`UNKNOWN` when it has no code). */
export function toCommandError(reason: unknown): CommandError {
  if (reason instanceof CommandError) return reason
  if (typeof reason === 'object' && reason !== null && 'code' in reason) {
    const { code, message, retry_after } = reason as Partial<Record<keyof CommandErrorBody, unknown>>
    if (typeof code === 'string') {
      return new CommandError(
        code,
        typeof message === 'string' ? message : '',
        typeof retry_after === 'number' ? retry_after : undefined,
      )
    }
  }
  if (typeof reason === 'string') return new CommandError('UNKNOWN', reason)
  if (reason instanceof Error) return new CommandError('UNKNOWN', reason.message)
  return new CommandError('UNKNOWN', 'unknown error')
}

/** Calls `command`; rejects with a `CommandError`. */
export async function call<T>(
  invoke: Invoke,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (reason) {
    throw toCommandError(reason)
  }
}
