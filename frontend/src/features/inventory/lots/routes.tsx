import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { INV_ACCESS } from '../stock/lib/permissions'

// Mounted under the authenticated shell; paths are relative to "/".
export const lotsRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission={INV_ACCESS.stock} />,
    children: [
      {
        path: 'inventory/lots',
        lazy: async () => ({ Component: (await import('./pages/LotsPage')).LotsPage }),
      },
      {
        path: 'inventory/lots/:id',
        lazy: async () => ({ Component: (await import('./pages/LotTracePage')).LotTracePage }),
      },
      {
        path: 'inventory/serials',
        lazy: async () => ({ Component: (await import('./pages/SerialsPage')).SerialsPage }),
      },
    ],
  },
]
