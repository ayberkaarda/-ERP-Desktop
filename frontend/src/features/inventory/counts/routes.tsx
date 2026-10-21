import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import type { PermissionRequirement } from '@/lib/permissions'
import { INV_OPEN } from '../documents/permissions'

function guarded(permission: PermissionRequirement, children: RouteObject[]): RouteObject {
  return { element: <RequireAuth permission={permission} />, children }
}

// Counts are stock documents of type count; the same document permissions apply.
export const countsRoutes: RouteObject[] = [
  guarded(INV_OPEN.documents, [
    {
      path: 'inventory/counts',
      lazy: async () => ({ Component: (await import('./pages/CountListPage')).CountListPage }),
    },
    {
      path: 'inventory/counts/:id',
      lazy: async () => ({ Component: (await import('./pages/CountPage')).CountPage }),
    },
  ]),
  guarded(INV_OPEN.newDocument, [
    {
      path: 'inventory/counts/new',
      lazy: async () => ({ Component: (await import('./pages/CountStartPage')).CountStartPage }),
    },
  ]),
]
