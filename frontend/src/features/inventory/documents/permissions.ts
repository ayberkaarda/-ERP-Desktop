import { anyOf } from '@/lib/permissions'

/** Permission names of the stock document, reservation and report endpoints (permissions.php). */
export const INV_PERMS = {
  documents: {
    view: 'inventory.documents.view',
    create: 'inventory.documents.create',
    post: 'inventory.documents.post',
    reverse: 'inventory.documents.reverse',
    /** Post documents flagged allow_expired (issue from expired lots). */
    issueExpired: 'inventory.documents.issue_expired',
  },
  stockView: 'inventory.stock.view',
  reservationsManage: 'inventory.reservations.manage',
  reportsView: 'inventory.reports.view',
} as const

/** Opening a page: the alternatives the API accepts for reading it. */
export const INV_OPEN = {
  documents: INV_PERMS.documents.view,
  newDocument: [INV_PERMS.documents.view, INV_PERMS.documents.create],
  /** Reservations are listed for stock viewers and for those who manage them. */
  reservations: anyOf(INV_PERMS.stockView, INV_PERMS.reservationsManage),
  reports: INV_PERMS.reportsView,
  /** GET /reports/reorder-suggestions is a stock read (inventory.stock.view). */
  reorder: INV_PERMS.stockView,
} as const
