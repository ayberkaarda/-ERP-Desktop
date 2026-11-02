// The services of the running app: the desktop platform built by the swapped
// runtime, its shell bridge and the web session functions. The web platform
// and session modules are loaded only inside the shell window, so importing
// the account screens elsewhere (jsdom tests, a plain browser) builds no
// platform.

import type { Platform } from '@/platform/types'

import type { Listen } from '../../bridge/events'
import type { Invoke } from '../../bridge/invoke'
import { isDesktopPlatform } from '../../platform'
import type { AccountServices } from './services'

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
