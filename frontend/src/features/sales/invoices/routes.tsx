import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import type { PermissionRequirement } from '@/lib/permissions'
import { SALES_OPEN } from './kit/permissions'

function guarded(permission: PermissionRequirement, children: RouteObject[]): RouteObject {
  return { element: <RequireAuth permission={permission} />, children }
}

const invoicePage = async () => ({
  Component: (await import('./pages/InvoicePage')).InvoicePage,
})

// Mounted under the authenticated shell; paths are relative to "/".
export const salesInvoicesRoutes: RouteObject[] = [
  guarded(SALES_OPEN.invoices, [
    {
      path: 'sales/invoices',
      lazy: async () => ({
        Component: (await import('./pages/InvoiceListPage')).InvoiceListPage,
      }),
    },
    { path: 'sales/invoices/:id', lazy: invoicePage },
    {
      path: 'sales/invoices/:id/print',
      lazy: async () => ({
        Component: (await import('./pages/InvoicePrintPage')).InvoicePrintPage,
      }),
    },
  ]),
  guarded(SALES_OPEN.newInvoice, [{ path: 'sales/invoices/new', lazy: invoicePage }]),
]
