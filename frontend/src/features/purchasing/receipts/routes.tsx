import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import type { PermissionRequirement } from '@/lib/permissions'
import { PURCH_OPEN } from '../invoices/kit/permissions'

function guarded(permission: PermissionRequirement, children: RouteObject[]): RouteObject {
  return { element: <RequireAuth permission={permission} />, children }
}

const receiptPage = async () => ({
  Component: (await import('./pages/ReceiptPage')).ReceiptPage,
})

// Mounted under the authenticated shell; paths are relative to "/". `new?order=<id>` starts a
// receipt for an order; without it a direct receipt.
export const purchaseReceiptsRoutes: RouteObject[] = [
  guarded(PURCH_OPEN.receipts, [
    {
      path: 'purchasing/receipts',
      lazy: async () => ({
        Component: (await import('./pages/ReceiptListPage')).ReceiptListPage,
      }),
    },
    { path: 'purchasing/receipts/:id', lazy: receiptPage },
    {
      path: 'purchasing/receipts/:id/print',
      lazy: async () => ({
        Component: (await import('./pages/ReceiptPrintPage')).ReceiptPrintPage,
      }),
    },
  ]),
  guarded(PURCH_OPEN.newReceipt, [{ path: 'purchasing/receipts/new', lazy: receiptPage }]),
]
