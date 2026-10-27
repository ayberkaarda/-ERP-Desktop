import { describe, expect, it } from 'vitest'

import { call, CommandError, toCommandError, type Invoke } from './invoke'

describe('toCommandError', () => {
  it('reads the shell error object', () => {
    const error = toCommandError({ code: 'RATE_LIMITED', message: 'slow down', retry_after: 7 })
    expect(error).toBeInstanceOf(CommandError)
    expect(error).toBeInstanceOf(Error)
    expect([error.code, error.message, error.retryAfter]).toEqual(['RATE_LIMITED', 'slow down', 7])
  })

  it('leaves retryAfter out when the shell sent none', () => {
    const error = toCommandError({ code: 'STORE_ERROR', message: 'x' })
    expect(error.retryAfter).toBeUndefined()
  })

  it('fills a missing or odd message and retry_after', () => {
    const error = toCommandError({ code: 'X', message: 5, retry_after: 'soon' })
    expect([error.message, error.retryAfter]).toEqual(['', undefined])
  })

  it('wraps a string and an Error as UNKNOWN', () => {
    expect(toCommandError('boom')).toMatchObject({ code: 'UNKNOWN', message: 'boom' })
    expect(toCommandError(new Error('bad'))).toMatchObject({ code: 'UNKNOWN', message: 'bad' })
  })

  it('wraps unknown values and objects without a string code', () => {
    expect(toCommandError(undefined)).toMatchObject({ code: 'UNKNOWN', message: 'unknown error' })
    expect(toCommandError(42)).toMatchObject({ code: 'UNKNOWN' })
    expect(toCommandError({ code: 7 })).toMatchObject({ code: 'UNKNOWN' })
  })

  it('returns a CommandError as it is', () => {
    const original = new CommandError('A', 'b', 1)
    expect(toCommandError(original)).toBe(original)
  })
})

describe('call', () => {
  it('passes the command and arguments and returns the answer', async () => {
    const seen: unknown[] = []
    const invoke = ((command: string, args?: Record<string, unknown>) => {
      seen.push(command, args)
      return Promise.resolve({ ok: true })
    }) as Invoke
    expect(await call(invoke, 'sync_status', { a: 1 })).toEqual({ ok: true })
    expect(seen).toEqual(['sync_status', { a: 1 }])
  })

  it('rejects with a CommandError', async () => {
    const invoke = (() =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      Promise.reject({ code: 'NO_ACTIVE_PROFILE', message: 'none' })) as Invoke
    await expect(call(invoke, 'sync_status')).rejects.toMatchObject({
      name: 'CommandError',
      code: 'NO_ACTIVE_PROFILE',
    })
  })
})
