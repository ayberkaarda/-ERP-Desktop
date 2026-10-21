import { ACC_ACCESS, ACC_PERMISSIONS } from './permissions'

/** Screens of this part of the Accounting feature, in subnav order. */
export const ACCOUNTING_SETUP_ROUTES = [
  { key: 'accounts', path: '/accounting/accounts', permission: ACC_ACCESS.accounts },
  {
    key: 'fiscalYears',
    path: '/accounting/fiscal-years',
    permission: ACC_ACCESS.fiscalYears,
  },
  { key: 'periods', path: '/accounting/periods', permission: ACC_ACCESS.periods },
  {
    key: 'determination',
    path: '/accounting/determination',
    permission: ACC_PERMISSIONS.determination.manage,
  },
] as const
