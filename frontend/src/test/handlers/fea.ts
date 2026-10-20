import { http, HttpResponse } from 'msw'
import type { ApiCompany, ApiSession, ApiUser } from '@/features/auth/api/types'
import type { ApiNotification } from '@/features/notifications/api'

// In-memory stand-in for the identity + notifications API (PHASE1 "HTTP API").

export const VALID_PASSWORD = 'correct-horse'
export const VALID_TOTP = '123456'
export const VALID_RECOVERY = 'abcde-fghij'
export const COMPANY_A = '0192a000-0000-7000-8000-00000000000a'
export const COMPANY_B = '0192a000-0000-7000-8000-00000000000b'

export interface FeaDb {
  user: ApiUser
  password: string
  companies: ApiCompany[]
  permissions: Record<string, string[]>
  sessions: ApiSession[]
  notifications: ApiNotification[]
  authenticated: boolean
  pendingTwoFactor: boolean
  /** Number of failed logins before 429 TOO_MANY_ATTEMPTS. */
  lockoutAfter: number
  failedLogins: number
  calls: { method: string; path: string; body: unknown; headers: Headers }[]
}

export function createFeaDb(overrides: Partial<FeaDb> = {}): FeaDb {
  return {
    user: {
      id: '0192a000-0000-7000-8000-0000000000u1',
      name: 'Deniz Kaya',
      email: 'deniz@keystone.test',
      locale: 'tr',
      is_super_admin: false,
      must_change_password: false,
      two_factor_enabled: false,
    },
    password: VALID_PASSWORD,
    companies: [
      { id: COMPANY_A, name: 'Anadolu Makina A.Ş.', role_names: ['Muhasebe'] },
      { id: COMPANY_B, name: 'Ege Dış Ticaret Ltd. Şti.', role_names: ['Yönetici'] },
    ],
    permissions: { [COMPANY_A]: ['dashboard.view'], [COMPANY_B]: ['dashboard.view', 'users.view'] },
    sessions: [
      {
        id: 's-current',
        ip_address: '10.0.0.5',
        user_agent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
        last_active_at: '2026-10-21T08:00:00Z',
        is_current: true,
      },
      {
        id: 's-phone',
        ip_address: '10.0.0.9',
        user_agent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        last_active_at: '2026-10-20T17:30:00Z',
        is_current: false,
      },
    ],
    notifications: [
      {
        id: 'n1',
        type: 'approval.requested',
        data: { title: 'Onay bekleyen fatura', body: 'FTR-2026-000042', url: '/system/health' },
        read_at: null,
        created_at: '2026-10-21T07:45:00Z',
      },
      {
        id: 'n2',
        type: 'export.ready',
        title: 'Dışa aktarım hazır',
        read_at: '2026-10-20T10:00:00Z',
        created_at: '2026-10-20T09:00:00Z',
      },
    ],
    authenticated: false,
    pendingTwoFactor: false,
    lockoutAfter: 5,
    failedLogins: 0,
    calls: [],
    ...overrides,
  }
}

const error = (status: number, code: string, message: string, fields?: Record<string, string[]>) =>
  HttpResponse.json({ errors: { message, code, ...(fields ? { fields } : {}) } }, { status })

const unauthenticated = () => error(401, 'UNAUTHENTICATED', 'Unauthenticated.')

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json()
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function feaHandlers(db: FeaDb) {
  const record = async (request: Request) => {
    const url = new URL(request.url)
    const body = request.method === 'GET' ? undefined : await readJson(request.clone())
    db.calls.push({ method: request.method, path: url.pathname, body, headers: request.headers })
  }

  return [
    http.get('*/sanctum/csrf-cookie', async ({ request }) => {
      await record(request)
      return new HttpResponse(null, { status: 204 })
    }),

    http.post('*/api/v1/auth/login', async ({ request }) => {
      await record(request)
      const body = await readJson(request)
      if (db.failedLogins >= db.lockoutAfter) {
        return error(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts.')
      }
      if (body.email !== db.user.email || body.password !== db.password) {
        db.failedLogins += 1
        return error(422, 'VALIDATION_ERROR', 'Invalid.', {
          email: ['Bu bilgilerle eşleşen bir hesap bulunamadı.'],
        })
      }
      if (db.user.two_factor_enabled) {
        db.pendingTwoFactor = true
        return HttpResponse.json({ data: { user: null, two_factor_required: true } })
      }
      db.authenticated = true
      return HttpResponse.json({ data: { user: db.user, two_factor_required: false } })
    }),

    http.post('*/api/v1/auth/two-factor/verify', async ({ request }) => {
      await record(request)
      if (!db.pendingTwoFactor) return unauthenticated()
      const body = await readJson(request)
      if (body.code === VALID_TOTP || body.recovery_code === VALID_RECOVERY) {
        db.pendingTwoFactor = false
        db.authenticated = true
        return HttpResponse.json({ data: { user: db.user } })
      }
      return error(422, 'INVALID_TWO_FACTOR_CODE', 'Invalid code.')
    }),

    http.post('*/api/v1/auth/logout', async ({ request }) => {
      await record(request)
      db.authenticated = false
      return new HttpResponse(null, { status: 204 })
    }),

    http.get('*/api/v1/auth/me', async ({ request }) => {
      await record(request)
      if (!db.authenticated) return unauthenticated()
      return HttpResponse.json({
        data: { user: db.user, companies: db.companies, permissions: db.permissions },
      })
    }),

    http.post('*/api/v1/auth/password/change', async ({ request }) => {
      await record(request)
      if (!db.authenticated) return unauthenticated()
      const body = await readJson(request)
      if (body.current_password !== db.password) {
        return error(422, 'VALIDATION_ERROR', 'Invalid.', {
          current_password: ['Geçerli parola hatalı.'],
        })
      }
      db.password = String(body.password)
      db.user = { ...db.user, must_change_password: false }
      return new HttpResponse(null, { status: 204 })
    }),

    http.post('*/api/v1/auth/two-factor/setup', async ({ request }) => {
      await record(request)
      const setupBody = await readJson(request)
      if (setupBody.password !== db.password) {
        return error(422, 'VALIDATION_ERROR', 'Parola hatalı.', { password: ['Parola hatalı.'] })
      }
      return HttpResponse.json({
        data: {
          secret: 'JBSWY3DPEHPK3PXP',
          otpauth_url: 'otpauth://totp/Keystone:deniz@keystone.test?secret=JBSWY3DPEHPK3PXP',
          qr_svg:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
        },
      })
    }),

    http.post('*/api/v1/auth/two-factor/confirm', async ({ request }) => {
      await record(request)
      const body = await readJson(request)
      if (body.password !== db.password) {
        return error(422, 'VALIDATION_ERROR', 'Parola hatalı.', { password: ['Parola hatalı.'] })
      }
      if (body.code !== VALID_TOTP) return error(422, 'INVALID_TWO_FACTOR_CODE', 'Invalid code.')
      db.user = { ...db.user, two_factor_enabled: true }
      return HttpResponse.json({ data: { recovery_codes: [VALID_RECOVERY, 'klmno-pqrst'] } })
    }),

    http.delete('*/api/v1/auth/two-factor', async ({ request }) => {
      await record(request)
      const body = await readJson(request)
      if (body.password !== db.password) {
        return error(422, 'VALIDATION_ERROR', 'Parola hatalı.', { password: ['Parola hatalı.'] })
      }
      db.user = { ...db.user, two_factor_enabled: false }
      return new HttpResponse(null, { status: 204 })
    }),

    http.get('*/api/v1/auth/sessions', async ({ request }) => {
      await record(request)
      return HttpResponse.json({ data: db.sessions })
    }),

    http.delete('*/api/v1/auth/sessions/:id', async ({ request, params }) => {
      await record(request)
      db.sessions = db.sessions.filter((s) => s.id !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),

    http.get('*/api/v1/notifications', async ({ request }) => {
      await record(request)
      return HttpResponse.json({
        data: db.notifications,
        meta: { unread_count: db.notifications.filter((n) => !n.read_at).length },
      })
    }),

    http.patch('*/api/v1/notifications/:id/read', async ({ request, params }) => {
      await record(request)
      db.notifications = db.notifications.map((n) =>
        n.id === params.id ? { ...n, read_at: n.read_at ?? '2026-10-21T09:00:00Z' } : n,
      )
      return new HttpResponse(null, { status: 204 })
    }),

    http.post('*/api/v1/notifications/read-all', async ({ request }) => {
      await record(request)
      db.notifications = db.notifications.map((n) => ({
        ...n,
        read_at: n.read_at ?? '2026-10-21T09:00:00Z',
      }))
      return new HttpResponse(null, { status: 204 })
    }),
  ]
}
