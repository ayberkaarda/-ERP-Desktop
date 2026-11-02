// The shell bridge the desktop screens use: commands and the three shell events,
// over the same `invoke`/`listen` the adaptor was built with. Only runtime.ts
// imports Tauri; the screens reach the shell through this object.
//
// It hands out wrappers, never the functions it was given: every command
// failure leaves as a `CommandError`, and a listener gets the event payload
// alone (not the raw Tauri event). No shell command or event carries a token.

import { ENGINE_EVENT, PROFILE_STATE_EVENT, REALTIME_EVENT, type Listen } from '../../bridge/events'
import { call, CommandError, toCommandError, type Invoke } from '../../bridge/invoke'

export interface DesktopBridge {
  readonly invoke: Invoke
  readonly listen: Listen
}

/** The events `listen` accepts; any other name is refused. */
export const DESKTOP_BRIDGE_EVENTS: readonly string[] = Object.freeze([
  ENGINE_EVENT,
  REALTIME_EVENT,
  PROFILE_STATE_EVENT,
])

export function createDesktopBridge(invoke: Invoke, listen: Listen): DesktopBridge {
  const bridgeInvoke: Invoke = (command, args) => call(invoke, command, args)
  const bridgeListen: Listen = async (event, handler) => {
    if (!DESKTOP_BRIDGE_EVENTS.includes(event)) {
      throw new CommandError('UNKNOWN_EVENT', `not a shell event: ${event}`)
    }
    try {
      return await listen(event, ({ payload }) => {
        handler({ payload })
      })
    } catch (reason) {
      throw toCommandError(reason)
    }
  }
  return Object.freeze({ invoke: bridgeInvoke, listen: bridgeListen })
}
