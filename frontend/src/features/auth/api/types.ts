// Mirrors the identity endpoints in PHASE1 "HTTP API"; replace with generated types once served.

export interface ApiUser {
  id: string
  name: string
  email: string
  locale: string | null
  is_super_admin: boolean
  must_change_password: boolean
  two_factor_enabled: boolean
}

export interface ApiCompany {
  id: string
  name: string
  role_names: string[]
}

export interface MeResponse {
  data: {
    user: ApiUser
    companies: ApiCompany[]
    permissions: Record<string, string[]>
  }
}

export interface LoginRequest {
  email: string
  password: string
  remember: boolean
}

export interface LoginResponse {
  data: { user: ApiUser | null; two_factor_required: boolean }
}

export type TwoFactorVerifyRequest = { code: string } | { recovery_code: string }

export interface ChangePasswordRequest {
  current_password: string
  password: string
  password_confirmation: string
}

export interface TwoFactorSetup {
  secret: string
  otpauth_url: string
  qr_svg: string
}

export interface ApiSession {
  id: string
  ip_address: string | null
  user_agent: string | null
  last_active_at: string
  is_current: boolean
}
