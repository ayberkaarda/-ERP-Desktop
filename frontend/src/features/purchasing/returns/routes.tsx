import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import type { PermissionRequirement } from '@/lib/permissions'
import { PURCH_OPEN } from '../invoices/kit/permissions'

function guarded(permission: PermissionRequirement, children: RouteObject[]): RouteObject {
  return { element: <RequireAuth permission={permission} />, children }
}

const returnPage = async () => ({
  Component: (await import('./pages/ReturnPage')).ReturnPage,
})

// Mounted under the authenticated shell; paths are relative to "/". New returns start from a
// booked invoice (`new?invoice=<id>`) or a posted receipt (`new?receipt=<id>`).
export const purchaseReturnsRoutes: RouteObject[] = [
  guarded(PURCH_OPEN.returns, [
    {
      path: 'purchasing/returns',
      lazy: async () => ({
        Component: (await import('./pages/ReturnListPage')).ReturnListPage,
      }),
    },
    { path: 'purchasing/returns/:id', lazy: returnPage },
    {
      path: 'purchasing/returns/:id/print',
      lazy: async () => ({
        Component: (await import('./pages/ReturnPrintPage')).ReturnPrintPage,
      }),
    },
  ]),
  guarded(PURCH_OPEN.newReturn, [{ path: 'purchasing/returns/new', lazy: returnPage }]),
]
