import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import type { PermissionRequirement } from '@/lib/permissions'
import { SALES_OPEN } from '../invoices/kit/permissions'

function guarded(permission: PermissionRequirement, children: RouteObject[]): RouteObject {
  return { element: <RequireAuth permission={permission} />, children }
}

const returnPage = async () => ({
  Component: (await import('./pages/ReturnPage')).ReturnPage,
})

// Mounted under the authenticated shell; paths are relative to "/".
export const salesReturnsRoutes: RouteObject[] = [
  guarded(SALES_OPEN.returns, [
    {
      path: 'sales/returns',
      lazy: async () => ({
        Component: (await import('./pages/ReturnListPage')).ReturnListPage,
      }),
    },
    { path: 'sales/returns/:id', lazy: returnPage },
    {
      path: 'sales/returns/:id/print',
      lazy: async () => ({
        Component: (await import('./pages/ReturnPrintPage')).ReturnPrintPage,
      }),
    },
  ]),
  // ?invoice=<id>: returns start from an issued invoice (its line selection reads the invoice).
  guarded(
    [...SALES_OPEN.newReturn, 'sales.invoices.view'],
    [{ path: 'sales/returns/new', lazy: returnPage }],
  ),
]
