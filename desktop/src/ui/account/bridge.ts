// The one place ui/account gets the shell bridge from: the desktop platform
// carries it as desktop.bridge (commands and the three shell events). Tests
// inject the fake bridge through AccountGate's services instead.
//
// Commands used by ui/account: profile_state, profile_list, profile_add,
// profile_select, profile_reset, profile_remove, profile_refresh_meta,
// profile_select_company, auth_login, auth_devices_list, auth_devices_revoke,
// open_external, app_info (auth_sign_out and sync_status through the platform
// session). Event: profile-state.

import type { Platform } from '@/platform/types'

import { desktopBridgeOf, type DesktopBridge } from '../../platform'

export type ShellBridge = DesktopBridge

/** The shell bridge of the desktop platform; null on the web platform. */
export function bridgeOf(target: Platform): ShellBridge | null {
  return desktopBridgeOf(target) ?? null
}
