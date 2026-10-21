import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { accountsRoutes } from '@/features/accounting/accounts/routes'
import { determinationRoutes } from '@/features/accounting/determination/routes'
import { fiscalRoutes } from '@/features/accounting/fiscal/routes'
import { journalRoutes } from '@/features/accounting/journal/routes'
import { periodsRoutes } from '@/features/accounting/periods/routes'
import { reportsRoutes } from '@/features/accounting/reports/routes'
import { bindAuthFailures } from '@/features/auth/session'
import { catalogRoutes } from '@/features/catalog/routes'
import { partyRoutes } from '@/features/parties/routes'
import { referenceRoutes } from '@/features/reference/routes'
import { GuestOnly, RequireAuth } from './guards'
import { RouteError } from './RouteError'

// Dev-only routes (e.g. /showcase) live in an optional ./devRoutes.tsx exporting `devRoutes`;
// the glob keeps this file compiling whether or not it exists.
const devModules = import.meta.env.DEV
  ? import.meta.glob<{ devRoutes?: RouteObject[] }>('./devRoutes.tsx', { eager: true })
  : {}
const devRoutes = Object.values(devModules).flatMap((m) => m.devRoutes ?? [])

// Each page is its own chunk; modules add their routes here as they land.
export const routes: RouteObject[] = [
  {
    path: '/login',
    element: <GuestOnly />,
    errorElement: <RouteError />,
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('@/features/auth/pages/LoginPage')).LoginPage,
        }),
      },
    ],
  },
  {
    path: '/password/change',
    element: <RequireAuth allowPasswordChange />,
    errorElement: <RouteError />,
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('@/features/auth/pages/ForcePasswordChangePage'))
            .ForcePasswordChangePage,
        }),
      },
    ],
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          {
            index: true,
            lazy: async () => ({
              Component: (await import('@/features/dashboard/pages/DashboardPage')).DashboardPage,
            }),
          },
          {
            path: 'system/health',
            lazy: async () => ({
              Component: (await import('@/features/system/pages/HealthPage')).HealthPage,
            }),
          },
          {
            path: 'profile/security',
            lazy: async () => ({
              Component: (await import('@/features/auth/pages/SecurityPage')).SecurityPage,
            }),
          },
          ...partyRoutes,
          ...catalogRoutes,
          ...referenceRoutes,
          ...accountsRoutes,
          ...fiscalRoutes,
          ...periodsRoutes,
          ...determinationRoutes,
          ...journalRoutes,
          ...reportsRoutes,
          ...devRoutes,
          {
            path: '*',
            lazy: async () => ({
              Component: (await import('@/components/shared/NotFound')).NotFound,
            }),
          },
        ],
      },
    ],
  },
]

export function createRouter() {
  const router = createBrowserRouter(routes)
  bindAuthFailures(router)
  return router
}
