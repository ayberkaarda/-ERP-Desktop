import { describe, expect, it } from 'vitest'

import * as shared from '@/platform/shared'
import { ApiError } from '@/platform/types'

import { createFakeBridge, fail, flush } from '../../test/fakeBridge'
import { createDesktopSession } from './session'
import * as surface from './index'

// The adapter uses the web platform modules themselves, not a copy: the class a
// feature checks with `instanceof` and the cancel marker the web sign-out and
// company-switch flows read must be the very same objects.
const sources = import.meta.glob<string>(['../**/*.ts', '!../**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('web platform modules', () => {
  it('re-exports the shared cancel marker itself', () => {
    expect(surface.PlatformCancelledError).toBe(shared.PlatformCancelledError)
    expect(surface.isPlatformCancelled).toBe(shared.isPlatformCancelled)
  })

  it('rejects a kept sign-out with an error the web cancel check recognises', async () => {
    const bridge = createFakeBridge({
      commands: { auth_sign_out: () => ({ status: 'pending_work', outbox: 1, conflicts: 0 }) },
    })
    const session = createDesktopSession({
      invoke: bridge.invoke,
      pendingWork: () => () => Promise.resolve('keep'),
      onChanged: () => undefined,
    })
    const error: unknown = await session.logout().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(shared.PlatformCancelledError)
    expect(shared.isPlatformCancelled(error)).toBe(true)
    expect(error).not.toBeInstanceOf(ApiError)
  })

  it('rejects a failed sign-out with the web ApiError, never a cancel', async () => {
    const bridge = createFakeBridge({ commands: { auth_sign_out: () => fail('NETWORK_ERROR') } })
    const session = createDesktopSession({
      invoke: bridge.invoke,
      pendingWork: () => undefined,
      onChanged: () => undefined,
    })
    const error: unknown = await session.logout().catch((e: unknown) => e)
    await flush()
    expect(error).toBeInstanceOf(ApiError)
    expect(shared.isPlatformCancelled(error)).toBe(false)
  })

  it('has no local copy of the web platform modules', () => {
    const offending = Object.entries(sources)
      .filter(([, text]) => /u1-shim|['"](?:\.\.\/)+frontend\//.test(text))
      .map(([file]) => file)
    expect(offending).toEqual([])
    expect(Object.keys(sources).some((file) => file.includes('u1-shim'))).toBe(false)
  })
})
