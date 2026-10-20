import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { RouteError } from './RouteError'

// Each page is its own chunk; modules add their routes here as they land.
export const routes: RouteObject[] = [
  {
    path: '/login',
    errorElement: <RouteError />,
    lazy: async () => ({ Component: (await import('@/features/auth/pages/LoginPage')).LoginPage }),
  },
  {
    path: '/',
    element: <AppShell />,
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
  return createBrowserRouter(routes)
}
