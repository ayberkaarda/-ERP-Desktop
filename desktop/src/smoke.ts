// Smoke page of the shell skeleton: calls `app_info` and shows the answer.
// No framework; the real UI arrives with the desktop platform adapter.

export interface AppInfo {
  name: string
  version: string
  identifier: string
  sync_schema_version: number
  os: string
  debug: boolean
}

/** `{code, message, retry_after?}` of a failed command. */
export interface CommandErrorBody {
  code: string
  message: string
  retry_after?: number
}

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export type SmokeResult = { ok: true; info: AppInfo } | { ok: false; error: CommandErrorBody }

/** Any rejection value becomes `{code, message}`. */
export function toCommandError(reason: unknown): CommandErrorBody {
  if (typeof reason === 'object' && reason !== null && 'code' in reason) {
    const { code, message, retry_after } = reason as Partial<CommandErrorBody>
    if (typeof code === 'string') {
      const body: CommandErrorBody = {
        code,
        message: typeof message === 'string' ? message : '',
      }
      if (typeof retry_after === 'number') body.retry_after = retry_after
      return body
    }
  }
  if (typeof reason === 'string') return { code: 'UNKNOWN', message: reason }
  if (reason instanceof Error) return { code: 'UNKNOWN', message: reason.message }
  return { code: 'UNKNOWN', message: 'unknown error' }
}

export async function runSmoke(invoke: Invoke): Promise<SmokeResult> {
  try {
    return { ok: true, info: await invoke<AppInfo>('app_info') }
  } catch (reason) {
    return { ok: false, error: toCommandError(reason) }
  }
}

export function describe(result: SmokeResult): { status: string; output: string } {
  if (result.ok) {
    const { name, version } = result.info
    return {
      status: `${name} ${version}`,
      output: JSON.stringify(result.info, null, 2),
    }
  }
  return {
    status: `app_info failed: ${result.error.code}`,
    output: JSON.stringify(result.error, null, 2),
  }
}
