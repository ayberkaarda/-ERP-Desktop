import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { INV_ACCESS } from './lib/permissions'

// Mounted under the authenticated shell; paths are relative to "/".
export const stockRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission={INV_ACCESS.stock} />,
    children: [
      {
        path: 'inventory/stock',
        lazy: async () => ({
          Component: (await import('./pages/StockStatusPage')).StockStatusPage,
        }),
      },
    ],
  },
]
