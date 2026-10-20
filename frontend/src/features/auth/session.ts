import i18n from '@/lib/i18n'
import { queryClient } from '@/lib/queryClient'
import { isApiError, platform, setAuthFailureHandler, type AuthFailure } from '@/platform'
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

let inFlight: Promise<SessionUser | null> | null = null

/**
 * Loads /auth/me into the stores. Resolves null when there is no session; rethrows other
 * failures (network, 5xx) so the caller can offer a retry.
 */
export function loadSession(): Promise<SessionUser | null> {
  inFlight ??= authApi
    .me()
    .then((r) => applyMe(r.data))
    .catch((error: unknown) => {
      if (isApiError(error) && (error.status === 401 || error.status === 403)) {
        endSession()
        return null
      }
      throw error
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Drops every trace of the signed-in user from memory. */
export function endSession() {
  platform.realtime.disconnect()
  useAuthStore.getState().clear()
  useCompanyStore.getState().clear()
  queryClient.clear()
}

export async function logout() {
  try {
    await authApi.logout()
  } catch {
    // The local session ends regardless; the cookie expires server side.
  }
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
