import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { ACC_PERMISSIONS } from '../shared/permissions'

// Mounted under the authenticated shell; paths are relative to "/".
export const fiscalRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission={ACC_PERMISSIONS.periods.view} />,
    children: [
      {
        path: 'accounting/fiscal-years',
        lazy: async () => ({
          Component: (await import('./pages/FiscalYearsPage')).FiscalYearsPage,
        }),
      },
    ],
  },
]
