import { create } from 'zustand'

export interface SessionUser {
  id: string
  name: string
  email: string
  locale: string | null
  isSuperAdmin: boolean
  mustChangePassword: boolean
  twoFactorEnabled: boolean
}

/**
 * unknown: session not probed yet; anonymous: no session; authenticated: /auth/me loaded.
 * The session itself lives in the HttpOnly cookie, so nothing here is persisted.
 */
export type AuthStatus = 'unknown' | 'anonymous' | 'authenticated'

/** 'refreshing' / 'failed' deny every permission until a fresh /auth/me arrives. */
export type PermissionsState = 'fresh' | 'refreshing' | 'failed'

interface AuthState {
  status: AuthStatus
  user: SessionUser | null
  /** Permission names per company id, as served by /auth/me. */
  permissions: Record<string, string[]>
  permissionsState: PermissionsState
  setSession: (user: SessionUser, permissions: Record<string, string[]>) => void
  updateUser: (patch: Partial<SessionUser>) => void
  setPermissionsState: (state: PermissionsState) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: 'unknown',
  user: null,
  permissions: {},
  permissionsState: 'fresh',
  setSession: (user, permissions) =>
    set({ status: 'authenticated', user, permissions, permissionsState: 'fresh' }),
  updateUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : {})),
  setPermissionsState: (permissionsState) => set({ permissionsState }),
  clear: () => set({ status: 'anonymous', user: null, permissions: {}, permissionsState: 'fresh' }),
}))
