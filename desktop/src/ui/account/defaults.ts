// The services of the running app: the desktop platform built by the swapped
// runtime, its shell bridge and the web session functions.

import { endSession, loadSession, logout, safeRedirect } from '@/features/auth/session'
import { platform } from '@/platform'
import type { Platform } from '@/platform/types'

import { isDesktopPlatform } from '../../platform'
import { bridgeOf } from './bridge'
import type { AccountServices } from './services'

/** Client-side navigation from outside the router (the browser router follows popstate). */
export function openPathInApp(path: string): void {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** True inside the Tauri window. */
export function inShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Null on the web platform (no shell bridge). */
export function appServices(target: Platform = platform): AccountServices | null {
  const bridge = bridgeOf(target)
  if (!bridge || !isDesktopPlatform(target)) return null
  return {
    invoke: bridge.invoke,
    listen: bridge.listen,
    platform: target,
    session: {
      load: () => loadSession({ fresh: true }),
      end: endSession,
      signOut: logout,
      safeRedirect: (to) => safeRedirect(to),
    },
    openPath: openPathInApp,
  }
}
