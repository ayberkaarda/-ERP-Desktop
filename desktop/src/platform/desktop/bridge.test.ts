import { describe, expect, it, vi } from 'vitest'

import { CommandError, type Invoke } from '../../bridge/invoke'
import type { Listen } from '../../bridge/events'
import { createFakeBridge, fail, flush } from '../../test/fakeBridge'
import { createDesktopBridge, DESKTOP_BRIDGE_EVENTS } from './bridge'

describe('desktop bridge (UI surface)', () => {
  it('carries only invoke and listen, frozen', () => {
    const fake = createFakeBridge()
    const bridge = createDesktopBridge(fake.invoke, fake.listen)
    expect(Object.keys(bridge).sort()).toEqual(['invoke', 'listen'])
    expect(Object.isFrozen(bridge)).toBe(true)
  })

  it('does not hand out the functions it was given', () => {
    const fake = createFakeBridge()
    const bridge = createDesktopBridge(fake.invoke, fake.listen)
    expect(bridge.invoke).not.toBe(fake.invoke)
    expect(bridge.listen).not.toBe(fake.listen)
  })

  it('invoke passes the command and its arguments and returns the answer', async () => {
    const fake = createFakeBridge({ commands: { sync_status: (args) => ({ echoed: args }) } })
    const bridge = createDesktopBridge(fake.invoke, fake.listen)
    await expect(bridge.invoke('sync_status', { a: 1 })).resolves.toEqual({ echoed: { a: 1 } })
    expect(fake.calls).toEqual([{ command: 'sync_status', args: { a: 1 } }])
  })

  it('invoke blocks none of the shell commands the account and sync screens call', async () => {
    const used = [
      // account screens (P3)
      'profile_state', 'profile_list', 'profile_add', 'profile_select', 'profile_reset', 'profile_remove',
      'profile_refresh_meta', 'profile_select_company', 'auth_login', 'auth_devices_list',
      'auth_devices_revoke', 'open_external', 'app_info', 'auth_sign_out', 'auth_restore',
      // sync screens (P2)
      'sync_status', 'sync_now', 'outbox_list', 'outbox_retry', 'outbox_discard', 'conflicts_list',
      'conflicts_resolve', 'realtime_status', 'api_request',
    ]
    const fake = createFakeBridge({ commands: Object.fromEntries(used.map((name) => [name, () => name])) })
    const bridge = createDesktopBridge(fake.invoke, fake.listen)
    for (const name of used) await expect(bridge.invoke(name, { k: name })).resolves.toBe(name)
    expect(fake.calls.map((c) => c.command)).toEqual(used)
    expect(fake.unhandled).toEqual([])
  })

  it('invoke rejects with a CommandError carrying the shell code and retry_after', async () => {
    const fake = createFakeBridge({ commands: { sync_now: () => fail('RATE_LIMITED', 'slow down', 7) } })
    const bridge = createDesktopBridge(fake.invoke, fake.listen)
    const error: unknown = await bridge.invoke('sync_now').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CommandError)
    expect(error).toMatchObject({ code: 'RATE_LIMITED', message: 'slow down', retryAfter: 7 })
  })

  it('invoke turns a non-shell rejection into an UNKNOWN CommandError', async () => {
    const invoke = (() => Promise.reject(new Error('ipc broke'))) as Invoke
    const bridge = createDesktopBridge(invoke, createFakeBridge().listen)
    await expect(bridge.invoke('x')).rejects.toMatchObject({ name: 'CommandError', code: 'UNKNOWN', message: 'ipc broke' })
  })

  it('listen hears the shell events and passes only the payload', async () => {
    let raw: ((event: { payload: unknown }) => void) | undefined
    const listen = vi.fn<Listen>((_event, handler) => {
      raw = handler
      return Promise.resolve(() => undefined)
    })
    const bridge = createDesktopBridge(createFakeBridge().invoke, listen)
    const heard = vi.fn()
    await bridge.listen('engine-event', heard)
    expect(listen).toHaveBeenCalledWith('engine-event', expect.any(Function))
    // The real Tauri event also carries `event` and `id`; the UI gets the payload alone.
    raw?.({ payload: { a: 1 }, event: 'engine-event', id: 9 } as { payload: unknown })
    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard.mock.calls[0]?.[0]).toEqual({ payload: { a: 1 } })
  })

  it('listen covers the three shell events and its unlisten stops the handler', async () => {
    expect([...DESKTOP_BRIDGE_EVENTS].sort()).toEqual(['engine-event', 'profile-state', 'realtime-event'])
    const fake = createFakeBridge()
    const bridge = createDesktopBridge(fake.invoke, fake.listen)
    for (const name of DESKTOP_BRIDGE_EVENTS) {
      const heard = vi.fn()
      const stop = await bridge.listen(name, heard)
      expect(fake.listeners(name)).toBe(1)
      fake.emit(name, { n: name })
      expect(heard).toHaveBeenCalledWith({ payload: { n: name } })
      stop()
      expect(fake.listeners(name)).toBe(0)
      fake.emit(name, { n: name })
      expect(heard).toHaveBeenCalledTimes(1)
    }
  })

  it('listen refuses any other event without subscribing', async () => {
    const fake = createFakeBridge()
    const listen = vi.fn(fake.listen)
    const bridge = createDesktopBridge(fake.invoke, listen)
    const error: unknown = await bridge.listen('tauri://close-requested', () => undefined).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CommandError)
    expect(error).toMatchObject({ code: 'UNKNOWN_EVENT' })
    expect(listen).not.toHaveBeenCalled()
  })

  it('a failed listen rejects with a CommandError', async () => {
    const listen: Listen = () => Promise.reject(new Error('no runtime'))
    const bridge = createDesktopBridge(createFakeBridge().invoke, listen)
    await expect(bridge.listen('engine-event', () => undefined)).rejects.toMatchObject({
      name: 'CommandError',
      code: 'UNKNOWN',
      message: 'no runtime',
    })
    await flush()
  })
})
