// A stand-in for the Tauri bridge in tests: commands answer from handlers, events
// are pushed by hand. No test imports `@tauri-apps/api`; code under test takes
// `invoke` and `listen` as parameters and gets these.

import { ENGINE_EVENT, REALTIME_EVENT, type Listen, type Unlisten } from '../bridge/events'
import type { EngineEvent } from '../bridge/generated/EngineEvent'
import type { RealtimeEventDto } from '../bridge/generated/RealtimeEventDto'
import type { Invoke } from '../bridge/invoke'

/** Answer of a command: a value, a promise, or a throw (use `fail`). */
export type CommandHandler = (args: Record<string, unknown> | undefined) => unknown

export interface FakeCall {
  command: string
  args: Record<string, unknown> | undefined
}

export interface FakeBridge {
  invoke: Invoke
  listen: Listen
  /** Every command call, in order. */
  calls: FakeCall[]
  /** Commands that had no handler (each one also rejected). */
  unhandled: string[]
  /** Calls of one command. */
  callsOf(command: string): FakeCall[]
  /** Adds or replaces handlers. */
  handle(commands: Record<string, CommandHandler>): void
  emitEngine(event: EngineEvent): void
  emitRealtime(event: RealtimeEventDto): void
  /** Any payload on any event name (for malformed payloads). */
  emit(event: string, payload: unknown): void
  /** Live listeners of an event. */
  listeners(event: string): number
}

/** The rejection of a shell command (`{code, message, retry_after?}`). */
export function fail(code: string, message = code, retryAfter?: number): never {
  // The shell rejects with a plain object, not an Error.
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw retryAfter === undefined ? { code, message } : { code, message, retry_after: retryAfter }
}

/** A promise with its resolve/reject in hand, for ordering tests. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Lets pending promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

export function createFakeBridge(
  options: { commands?: Record<string, CommandHandler> } = {},
): FakeBridge {
  const commands = new Map(Object.entries(options.commands ?? {}))
  const calls: FakeCall[] = []
  const unhandled: string[] = []
  const handlers = new Map<string, Set<(event: { payload: unknown }) => void>>()

  const invoke = (async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args })
    const handler = commands.get(command)
    if (!handler) {
      unhandled.push(command)
      fail('FAKE_UNHANDLED_COMMAND', `no handler for ${command}`)
    }
    return await handler(args)
  }) as Invoke

  const listen: Listen = (event, handler) => {
    let set = handlers.get(event)
    if (!set) {
      set = new Set()
      handlers.set(event, set)
    }
    const own = (e: { payload: unknown }) => {
      handler(e)
    }
    set.add(own)
    const unlisten: Unlisten = () => {
      set.delete(own)
    }
    return Promise.resolve(unlisten)
  }

  const emit = (event: string, payload: unknown) => {
    for (const handler of [...(handlers.get(event) ?? [])]) handler({ payload })
  }

  return {
    invoke,
    listen,
    calls,
    unhandled,
    callsOf: (command) => calls.filter((c) => c.command === command),
    handle: (more) => {
      for (const [name, handler] of Object.entries(more)) commands.set(name, handler)
    },
    emitEngine: (event) => {
      emit(ENGINE_EVENT, event)
    },
    emitRealtime: (event) => {
      emit(REALTIME_EVENT, event)
    },
    emit,
    listeners: (event) => handlers.get(event)?.size ?? 0,
  }
}
