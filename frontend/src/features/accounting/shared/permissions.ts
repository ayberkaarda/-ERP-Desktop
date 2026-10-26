import { anyOf } from '@/lib/permissions'

/** Permission names of the Accounting module used by these screens (PHASE3 "HTTP API"). */
export const ACC_PERMISSIONS = {
  accounts: { view: 'accounting.accounts.view', manage: 'accounting.accounts.manage' },
  periods: {
    view: 'accounting.periods.view',
    manage: 'accounting.periods.manage',
    close: 'accounting.periods.close',
    reopen: 'accounting.periods.reopen',
  },
  year: { close: 'accounting.year.close' },
  determination: { manage: 'accounting.determination.manage' },
} as const

/**
 * Who may open each screen: the alternatives of the API's viewAny policies (AccountPolicy,
 * FiscalYearPolicy, AccountingPeriodPolicy). Write actions keep their own single permission.
 */
export const ACC_ACCESS = {
  accounts: anyOf(ACC_PERMISSIONS.accounts.view, ACC_PERMISSIONS.accounts.manage),
  fiscalYears: anyOf(ACC_PERMISSIONS.periods.view, ACC_PERMISSIONS.periods.manage),
  periods: anyOf(
    ACC_PERMISSIONS.periods.view,
    ACC_PERMISSIONS.periods.manage,
    ACC_PERMISSIONS.periods.close,
  ),
} as const
