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

interface AuthState {
  status: AuthStatus
  user: SessionUser | null
  /** Permission names per company id, as served by /auth/me. */
  permissions: Record<string, string[]>
  setSession: (user: SessionUser, permissions: Record<string, string[]>) => void
  updateUser: (patch: Partial<SessionUser>) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: 'unknown',
  user: null,
  permissions: {},
  setSession: (user, permissions) => set({ status: 'authenticated', user, permissions }),
  updateUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : {})),
  clear: () => set({ status: 'anonymous', user: null, permissions: {} }),
}))
