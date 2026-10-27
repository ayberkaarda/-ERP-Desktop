import { describe as suite, expect, it } from 'vitest'

import { describe, runSmoke, toCommandError, type AppInfo, type Invoke } from './smoke'

const info: AppInfo = {
  name: 'Keystone',
  version: '0.1.0',
  identifier: 'com.keystone.desktop',
  sync_schema_version: 1,
  os: 'windows',
  debug: true,
}

suite('runSmoke', () => {
  it('calls app_info and returns its answer', async () => {
    const calls: string[] = []
    const invoke = ((command: string) => {
      calls.push(command)
      return Promise.resolve(info)
    }) as Invoke
    const result = await runSmoke(invoke)
    expect(calls).toEqual(['app_info'])
    expect(result).toEqual({ ok: true, info })
    expect(describe(result).status).toBe('Keystone 0.1.0')
  })

  it('turns a failed command into its code', async () => {
    const invoke = (() => Promise.reject(new Error('boom'))) as Invoke
    const result = await runSmoke(invoke)
    expect(result).toEqual({ ok: false, error: { code: 'UNKNOWN', message: 'boom' } })
    expect(describe(result).status).toBe('app_info failed: UNKNOWN')
  })
})

suite('toCommandError', () => {
  it('keeps code, message and retry_after of a command error', () => {
    expect(toCommandError({ code: 'TOO_MANY_ATTEMPTS', message: 'wait', retry_after: 7 })).toEqual({
      code: 'TOO_MANY_ATTEMPTS',
      message: 'wait',
      retry_after: 7,
    })
  })

  it('normalizes strings, errors and unknown values', () => {
    expect(toCommandError('denied')).toEqual({ code: 'UNKNOWN', message: 'denied' })
    expect(toCommandError(new Error('x'))).toEqual({ code: 'UNKNOWN', message: 'x' })
    expect(toCommandError(42)).toEqual({ code: 'UNKNOWN', message: 'unknown error' })
    expect(toCommandError({ code: 5 })).toEqual({ code: 'UNKNOWN', message: 'unknown error' })
  })
})
