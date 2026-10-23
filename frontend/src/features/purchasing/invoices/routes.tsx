import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import type { PermissionRequirement } from '@/lib/permissions'
import { PURCH_OPEN } from './kit/permissions'

function guarded(permission: PermissionRequirement, children: RouteObject[]): RouteObject {
  return { element: <RequireAuth permission={permission} />, children }
}

const invoicePage = async () => ({
  Component: (await import('./pages/InvoicePage')).InvoicePage,
})

// Mounted under the authenticated shell; paths are relative to "/".
export const purchaseInvoicesRoutes: RouteObject[] = [
  guarded(PURCH_OPEN.invoices, [
    {
      path: 'purchasing/invoices',
      lazy: async () => ({
        Component: (await import('./pages/InvoiceListPage')).InvoiceListPage,
      }),
    },
    { path: 'purchasing/invoices/:id', lazy: invoicePage },
    {
      path: 'purchasing/invoices/:id/print',
      lazy: async () => ({
        Component: (await import('./pages/InvoicePrintPage')).InvoicePrintPage,
      }),
    },
  ]),
  guarded(PURCH_OPEN.newInvoice, [{ path: 'purchasing/invoices/new', lazy: invoicePage }]),
]
