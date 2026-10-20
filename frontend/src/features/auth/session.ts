import i18n from '@/lib/i18n'
import { queryClient } from '@/lib/queryClient'
import {
  bumpSessionGeneration,
  getSessionGeneration,
  isApiError,
  platform,
  setAuthFailureHandler,
  type AuthFailure,
} from '@/platform'
import { useAuthStore, type SessionUser } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { authApi } from './api/auth'
import type { ApiUser, MeResponse } from './api/types'

export function toSessionUser(u: ApiUser): SessionUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    locale: u.locale,
    isSuperAdmin: u.is_super_admin,
    mustChangePassword: u.must_change_password,
    twoFactorEnabled: u.two_factor_enabled,
  }
}

export function applyMe(me: MeResponse['data']): SessionUser {
  const user = toSessionUser(me.user)
  useCompanyStore
    .getState()
    .setCompanies(me.companies.map((c) => ({ id: c.id, name: c.name, roleNames: c.role_names })))
  useAuthStore.getState().setSession(user, me.permissions)
  // Realtime is opened only for an authenticated user and closed again in endSession.
  platform.realtime.connect()
  return user
}

interface Probe {
  gen: number
  controller: AbortController
  promise: Promise<SessionUser | null>
}

let inFlight: Probe | null = null
let latest: Probe | null = null
let probeSeq = 0

/**
 * Loads /auth/me into the stores. Resolves null when there is no session (or the session
 * ended while the probe ran); rethrows other failures so the caller can offer a retry.
 */
export function loadSession(options: { fresh?: boolean } = {}): Promise<SessionUser | null> {
  const gen = getSessionGeneration()
  if (!options.fresh && inFlight?.gen === gen) return inFlight.promise
  const controller = new AbortController()
  const id = ++probeSeq
  // A newer probe supersedes this one: its answer wins, this one is never applied.
  const superseded = () => (id !== probeSeq && latest ? latest.promise : null)
  const promise: Promise<SessionUser | null> = authApi
    .me(controller.signal)
    .then((r) => {
      const newer = superseded()
      if (newer) return newer
      return gen === getSessionGeneration() ? applyMe(r.data) : null
    })
    .catch((error: unknown) => {
      const newer = superseded()
      if (newer) return newer
      // A probe that outlived its session must not restore or clear anything.
      if (gen !== getSessionGeneration()) return null
      if (isApiError(error) && (error.status === 401 || error.status === 403)) {
        endSession()
        return null
      }
      throw error
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null
    })
  inFlight = { gen, controller, promise }
  latest = inFlight
  return promise
}

/**
 * Re-reads memberships and permissions (after a company switch). Permissions stay denied
 * until the fresh response is applied; a failure leaves them denied with state 'failed'.
 */
export async function refreshPermissions(): Promise<void> {
  useAuthStore.getState().setPermissionsState('refreshing')
  try {
    await loadSession({ fresh: true })
  } catch (error) {
    if (useAuthStore.getState().status === 'authenticated') {
      useAuthStore.getState().setPermissionsState('failed')
    }
    throw error
  }
}

/** Drops every trace of the signed-in user from memory. */
export function endSession() {
  bumpSessionGeneration()
  inFlight?.controller.abort()
  latest = null
  inFlight = null
  platform.realtime.disconnect()
  useAuthStore.getState().clear()
  useCompanyStore.getState().clear()
  queryClient.clear()
}

async function serverLogout() {
  try {
    await authApi.logout()
  } catch (error) {
    // 401: the server has no session any more, which is what we asked for.
    if (isApiError(error) && error.status === 401) return
    if (isApiError(error) && error.status === 419) {
      await platform.http.prepareSession()
      try {
        await authApi.logout()
      } catch (retryError) {
        if (isApiError(retryError) && retryError.status === 401) return
        throw retryError
      }
      return
    }
    throw error
  }
}

/**
 * Ends the session on the server, then locally. Throws when the server did not confirm, so
 * the caller can retry or explicitly fall back to signOutLocally().
 */
export async function logout() {
  await serverLogout()
  endSession()
}

/** Local-only sign-out after a failed logout; the server session may stay active. */
export function signOutLocally() {
  endSession()
}

/** Only same-app paths are honoured as post-login targets (no open redirects). */
export function safeRedirect(target: unknown, fallback = '/'): string {
  if (typeof target !== 'string') return fallback
  // "//host" and "/\host" are protocol-relative to browsers.
  if (!/^\/(?![/\\])/.test(target)) return fallback
  if (target.startsWith('/login')) return fallback
  return target
}

export const PASSWORD_CHANGE_PATH = '/password/change'

interface Navigator {
  navigate: (to: string, opts?: { replace?: boolean; state?: unknown }) => unknown
  state: { location: { pathname: string; search: string } }
}

export function handleAuthFailure(router: Navigator, failure: AuthFailure) {
  const { pathname, search } = router.state.location
  if (failure === 'passwordChangeRequired') {
    useAuthStore.getState().updateUser({ mustChangePassword: true })
    if (pathname !== PASSWORD_CHANGE_PATH)
      void router.navigate(PASSWORD_CHANGE_PATH, { replace: true })
    return
  }
  if (failure === 'deactivated') platform.notify.error(i18n.t('auth.errors.deactivated'))
  else if (useAuthStore.getState().status === 'authenticated')
    platform.notify.info(i18n.t('auth.errors.sessionExpired'))
  endSession()
  if (pathname !== '/login') {
    void router.navigate('/login', { replace: true, state: { from: pathname + search } })
  }
}

/** Wires HTTP session failures to the given router; returns an unbind function. */
export function bindAuthFailures(router: Navigator): () => void {
  setAuthFailureHandler((failure) => handleAuthFailure(router, failure))
  return () => setAuthFailureHandler(null)
}
