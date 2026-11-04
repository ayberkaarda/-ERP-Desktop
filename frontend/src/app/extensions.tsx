import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router'
import type { OnlineOnlyState } from '@/lib/online-only/useOnlineOnly'

/**
 * Extension points another shell (the desktop app) fills by replacing this module at build
 * time. The web app ships them empty; every consumer falls back to the web behaviour.
 */
export interface AppExtensions {
  /** Extra pages inside the signed-in shell (under RequireAuth + AppShell). */
  routes: RouteObject[]
  /** Extra top-level pages outside the session guard (e.g. first-run setup). */
  publicRoutes: RouteObject[]
  /** Replaces the /login page. */
  LoginPage?: ComponentType
  /** Replaces the forced /password/change page. */
  PasswordChangePage?: ComponentType
  /** Rendered at the end of the security page. */
  SecurityExtras?: ComponentType
  /** Rendered in the top bar next to the connectivity badge. */
  HeaderExtras?: ComponentType
  /** Availability of a server-only action; absent means always available. */
  useOnlineOnly?: (action: string) => OnlineOnlyState
  /**
   * Ids of list rows shown with a change made on this device and not sent yet; list tables mark
   * those rows. Absent means no row is ever marked.
   */
  useDraftRows?: () => ReadonlySet<string>
}

export const appExtensions: AppExtensions = { routes: [], publicRoutes: [] }
