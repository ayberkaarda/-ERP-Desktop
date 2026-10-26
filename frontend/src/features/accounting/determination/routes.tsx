import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { ACC_PERMISSIONS } from '../shared/permissions'

// Mounted under the authenticated shell; paths are relative to "/".
export const determinationRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission={ACC_PERMISSIONS.determination.manage} />,
    children: [
      {
        path: 'accounting/determination',
        lazy: async () => ({
          Component: (await import('./pages/DeterminationPage')).DeterminationPage,
        }),
      },
    ],
  },
]
