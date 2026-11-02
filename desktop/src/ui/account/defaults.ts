// The services of the running app: the desktop platform built by the swapped
// runtime, its shell bridge and the web session functions. The web platform
// and session modules are loaded only inside the shell window, so importing
// the account screens elsewhere (jsdom tests, a plain browser) builds no
// platform.

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

/** Null when there is no shell bridge: the gate then leaves the web app alone. */
export async function loadAppServices(): Promise<AccountServices | null> {
  const [{ platform }, session] = await Promise.all([import('@/platform'), import('@/features/auth/session')])
  const bridge = bridgeOf(platform)
  if (!bridge || !isDesktopPlatform(platform)) return null
  return {
    ...bridge,
    platform,
    session: {
      load: () => session.loadSession({ fresh: true }),
      end: session.endSession,
      signOut: session.logout,
      safeRedirect: (target) => session.safeRedirect(target),
    },
    openPath: openPathInApp,
  }
}
