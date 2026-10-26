import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { INV_ACCESS } from '../stock/lib/permissions'

// Mounted under the authenticated shell; paths are relative to "/".
export const movementsRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission={INV_ACCESS.stock} />,
    children: [
      {
        path: 'inventory/movements',
        lazy: async () => ({
          Component: (await import('./pages/MovementsPage')).MovementsPage,
        }),
      },
    ],
  },
]
