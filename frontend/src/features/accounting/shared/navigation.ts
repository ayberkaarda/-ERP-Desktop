import { ACC_PERMISSIONS } from './permissions'

/** Screens of this part of the Accounting feature, in subnav order. */
export const ACCOUNTING_SETUP_ROUTES = [
  { key: 'accounts', path: '/accounting/accounts', permission: ACC_PERMISSIONS.accounts.view },
  {
    key: 'fiscalYears',
    path: '/accounting/fiscal-years',
    permission: ACC_PERMISSIONS.periods.view,
  },
  { key: 'periods', path: '/accounting/periods', permission: ACC_PERMISSIONS.periods.view },
  {
    key: 'determination',
    path: '/accounting/determination',
    permission: ACC_PERMISSIONS.determination.manage,
  },
] as const
