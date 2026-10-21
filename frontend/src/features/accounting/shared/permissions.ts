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
