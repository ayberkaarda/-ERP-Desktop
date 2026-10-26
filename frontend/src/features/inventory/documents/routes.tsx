import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import type { PermissionRequirement } from '@/lib/permissions'
import { INV_OPEN } from './permissions'

function guarded(permission: PermissionRequirement, children: RouteObject[]): RouteObject {
  return { element: <RequireAuth permission={permission} />, children }
}

const documentPage = async () => ({
  Component: (await import('./pages/StockDocumentPage')).StockDocumentPage,
})

// Mounted under the authenticated shell; paths are relative to "/".
export const documentsRoutes: RouteObject[] = [
  guarded(INV_OPEN.documents, [
    {
      path: 'inventory/documents',
      lazy: async () => ({
        Component: (await import('./pages/StockDocumentListPage')).StockDocumentListPage,
      }),
    },
    { path: 'inventory/documents/:id', lazy: documentPage },
  ]),
  guarded(INV_OPEN.newDocument, [{ path: 'inventory/documents/new', lazy: documentPage }]),
]
