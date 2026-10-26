import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import type { PermissionRequirement } from '@/lib/permissions'
import { SALES_ACCESS } from '../shared/permissions'

function guarded(permission: PermissionRequirement, children: RouteObject[]): RouteObject {
  return { element: <RequireAuth permission={permission} />, children }
}

const quotePage = async () => ({
  Component: (await import('./pages/QuotePage')).QuotePage,
})

// Mounted under the authenticated shell; paths are relative to "/".
export const quotesRoutes: RouteObject[] = [
  guarded(SALES_ACCESS.quoteList, [
    {
      path: 'sales/quotes',
      lazy: async () => ({ Component: (await import('./pages/QuoteListPage')).QuoteListPage }),
    },
    { path: 'sales/quotes/:id', lazy: quotePage },
  ]),
  guarded(SALES_ACCESS.quoteNew, [{ path: 'sales/quotes/new', lazy: quotePage }]),
]
