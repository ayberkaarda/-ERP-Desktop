import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { ACC_ACCESS } from '../shared/permissions'

// Mounted under the authenticated shell; paths are relative to "/".
export const accountsRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission={ACC_ACCESS.accounts} />,
    children: [
      {
        path: 'accounting/accounts',
        lazy: async () => ({
          Component: (await import('./pages/ChartOfAccountsPage')).ChartOfAccountsPage,
        }),
      },
    ],
  },
]
