// The one place ui/account gets the shell bridge from. The desktop platform
// is to carry it as `desktop.bridge` (P1 follow-up); until then this finds
// nothing and the gate leaves the web app alone. Tests inject the fake bridge
// through AccountGate's services instead.
//
// Commands used by ui/account: profile_state, profile_list, profile_add,
// profile_select, profile_reset, profile_remove, profile_refresh_meta,
// profile_select_company, auth_login, auth_devices_list, auth_devices_revoke,
// open_external, app_info (auth_sign_out and sync_status through the platform
// session). Event: profile-state.

import type { Platform } from '@/platform/types'

import type { Listen } from '../../bridge/events'
import type { Invoke } from '../../bridge/invoke'
import { isDesktopPlatform } from '../../platform'

export interface ShellBridge {
  invoke: Invoke
  listen: Listen
}

/**
 * The shell bridge the desktop platform carries as `desktop.bridge`
 * (`{invoke, listen}`, bound by the swapped runtime). Null on the web
 * platform or while the platform does not expose it.
 */
export function bridgeOf(target: Platform): ShellBridge | null {
  if (!isDesktopPlatform(target)) return null
  const { bridge } = target.desktop as { bridge?: unknown }
  if (typeof bridge !== 'object' || bridge === null) return null
  const { invoke, listen } = bridge as Partial<Record<keyof ShellBridge, unknown>>
  if (typeof invoke !== 'function' || typeof listen !== 'function') return null
  return { invoke: invoke as Invoke, listen: listen as Listen }
}
