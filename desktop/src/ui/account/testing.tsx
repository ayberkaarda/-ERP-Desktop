// Test harness of the account screens: the fake bridge, a desktop platform on
// top of it, web session stand-ins and a memory router with the account pages.
// Only test files import this module.

import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { vi } from 'vitest'

import { Providers } from '@/app/providers'
import { safeRedirect } from '@/features/auth/session'
import i18n from '@/lib/i18n'
import { useCompanyStore } from '@/stores/company'
import { createDesktopPlatform, type DesktopPlatform } from '../../platform'
import type { LoginDto } from '../../bridge/generated/LoginDto'
import type { ProfileDto } from '../../bridge/generated/ProfileDto'
import type { ProfileStateDto } from '../../bridge/generated/ProfileStateDto'
import { addDesktopResources } from '../../i18n'
import { createFakeBridge, type CommandHandler, type FakeBridge } from '../../test/fakeBridge'
import { AccountGate } from './AppGate'
import { DesktopLoginPage } from './DesktopLoginPage'
import { DesktopSecurityExtras } from './DesktopSecurityExtras'
import { ExternalPasswordChangePage } from './ExternalPasswordChangePage'
import { SetupPage } from './ProfilesPage'
import type { AccountServices, WebSession } from './services'
import type { SessionUser } from '@/stores/auth'

addDesktopResources(i18n)

export const PROFILE: ProfileDto = {
  id: 'p1',
  name: 'Merkez',
  base_url: 'http://localhost:8000',
  server_name: 'Keystone',
  server_version: '1.4.0',
  company_id: 'c1',
  created_at: '2026-10-01T10:00:00Z',
  realtime: true,
}

export const OTHER: ProfileDto = {
  ...PROFILE,
  id: 'p2',
  name: 'Şube',
  base_url: 'https://erp.example.test',
  server_version: '1.5.0',
  company_id: null,
  realtime: false,
}

export const READY: ProfileStateDto = { profile_id: 'p1', phase: 'ready' }

export const USER: SessionUser = {
  id: 'u1',
  name: 'Ada',
  email: 'ada@example.test',
  locale: 'tr',
  isSuperAdmin: false,
  mustChangePassword: false,
  twoFactorEnabled: false,
}

export function loginDto(patch: Partial<LoginDto> = {}): LoginDto {
  return {
    profile: PROFILE,
    generation: 1,
    user: { id: 'u1', name: 'Ada', email: 'ada@example.test', must_change_password: false },
    companies: [{ id: 'c1', name: 'Ana Şirket' }],
    company_required: false,
    ...patch,
  }
}

export interface Harness {
  bridge: FakeBridge
  platform: DesktopPlatform
  services: AccountServices
  session: { [K in keyof WebSession]: ReturnType<typeof vi.fn> }
  openPath: ReturnType<typeof vi.fn>
}

/** Fake shell with one active, ready profile unless the commands say otherwise. */
export function harness(commands: Record<string, CommandHandler> = {}): Harness {
  const bridge = createFakeBridge({
    commands: {
      profile_state: () => READY,
      profile_list: () => ({ active_id: 'p1', profiles: [PROFILE, OTHER] }),
      sync_status: () => ({
        state: 'idle',
        pending: 0,
        conflicts: 0,
        rejected: 0,
        quarantined: 0,
        failures: 0,
        manifest_mismatch: false,
      }),
      realtime_status: () => ({ state: 'disconnected' }),
      app_info: () => ({
        name: 'Keystone',
        version: '0.1.0',
        identifier: 'com.keystone.desktop',
        sync_schema_version: 1,
        os: 'windows',
        debug: true,
      }),
      ...commands,
    },
  })
  const platform = createDesktopPlatform({
    deps: {
      getCompanyId: () => 'c1',
      getLocale: () => 'tr',
      getSessionGeneration: () => 0,
      onAuthFailure: () => undefined,
    },
    invoke: bridge.invoke,
    listen: bridge.listen,
    notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  })
  const session = {
    // The real load stores the memberships of /auth/me.
    load: vi.fn(() => {
      useCompanyStore.getState().setCompanies([
        { id: 'c1', name: 'Ana Şirket', roleNames: [] },
        { id: 'c2', name: 'Şube', roleNames: [] },
      ])
      return Promise.resolve<SessionUser | null>(USER)
    }),
    end: vi.fn(),
    signOut: vi.fn(() => platform.session.logout()),
    safeRedirect: vi.fn(safeRedirect),
  }
  const openPath = vi.fn()
  const services: AccountServices = {
    invoke: bridge.invoke,
    listen: bridge.listen,
    platform,
    session,
    openPath,
  }
  return { bridge, platform, services, session, openPath }
}

const ROUTES: RouteObject[] = [
  { path: '/', element: <p>home</p> },
  { path: '/elsewhere', element: <p>elsewhere</p> },
  { path: '/login', element: <DesktopLoginPage /> },
  { path: '/password/change', element: <ExternalPasswordChangePage /> },
  { path: '/setup', element: <SetupPage /> },
  { path: '/profile/security', element: <DesktopSecurityExtras /> },
  { path: '/sync/outbox', element: <p>outbox</p> },
  { path: '*', element: null },
]

/** Renders the gate around a memory router that starts at `path`. */
export function renderApp(h: Harness, path = '/', state?: unknown) {
  const router = createMemoryRouter(ROUTES, { initialEntries: [{ pathname: path, state }] })
  const view = render(
    <Providers>
      <AccountGate services={h.services}>
        <RouterProvider router={router} />
      </AccountGate>
    </Providers>,
  )
  return { ...view, router }
}

/** Renders the gate around any children. */
export function renderGate(h: Harness, children: ReactNode = <p>web app</p>) {
  return render(
    <Providers>
      <AccountGate services={h.services}>{children}</AccountGate>
    </Providers>,
  )
}

export async function useTurkish(): Promise<void> {
  await i18n.changeLanguage('tr')
}
