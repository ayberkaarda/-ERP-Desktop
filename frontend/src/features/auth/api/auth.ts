import { queryOptions } from '@tanstack/react-query'
import { platform, type ApiSuccess } from '@/platform'
import type {
  ApiSession,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  MeResponse,
  TwoFactorSetup,
  TwoFactorVerifyRequest,
} from './types'

// Login steps own their errors (wrong password is not a session failure).
const own = { skipAuthHandling: true } as const

export const authApi = {
  async login(body: LoginRequest) {
    await platform.http.prepareSession()
    return platform.http.post<LoginResponse>('/auth/login', body, own)
  },
  verifyTwoFactor: (body: TwoFactorVerifyRequest) =>
    platform.http.post<unknown>('/auth/two-factor/verify', body, own),
  logout: () => platform.http.post<unknown>('/auth/logout', undefined, own),
  me: (signal?: AbortSignal) => platform.http.get<MeResponse>('/auth/me', { ...own, signal }),
  changePassword: (body: ChangePasswordRequest) =>
    platform.http.post<unknown>('/auth/password/change', body),
  setupTwoFactor: () => platform.http.post<ApiSuccess<TwoFactorSetup>>('/auth/two-factor/setup'),
  confirmTwoFactor: (code: string) =>
    platform.http.post<ApiSuccess<{ recovery_codes: string[] }>>('/auth/two-factor/confirm', {
      code,
    }),
  disableTwoFactor: (password: string) =>
    platform.http.delete<unknown>('/auth/two-factor', { body: { password } }),
  sessions: (signal?: AbortSignal) =>
    platform.http.get<ApiSuccess<ApiSession[]>>('/auth/sessions', { signal }),
  revokeSession: (id: string) =>
    platform.http.delete<unknown>(`/auth/sessions/${encodeURIComponent(id)}`),
}

export const authKeys = {
  sessions: ['auth', 'sessions'] as const,
}

export const sessionsQuery = () =>
  queryOptions({
    queryKey: authKeys.sessions,
    queryFn: ({ signal }) => authApi.sessions(signal),
    select: (r) => r.data,
  })
