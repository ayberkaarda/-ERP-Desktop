import { FolderTree, Upload } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { navCommand } from '../shared/commandUtils'
import { ACC_ACCESS, ACC_PERMISSIONS } from '../shared/permissions'

export const accountsCommands: readonly Command[] = [
  navCommand('accounts', '/accounting/accounts', 'accounts', ACC_ACCESS.accounts, FolderTree, [
    'hesap planı',
    'chart of accounts',
    'tdhp',
    'hesap',
  ]),
  navCommand(
    'accounts-flat',
    '/accounting/accounts?view=flat',
    'accountsFlat',
    ACC_ACCESS.accounts,
    FolderTree,
    ['hesap listesi', 'account list'],
  ),
  navCommand(
    'accounts-import',
    '/accounting/accounts?import=1',
    'accountsImport',
    ACC_PERMISSIONS.accounts.manage,
    Upload,
    ['içe aktar', 'import', 'csv', 'xlsx'],
    'actions',
  ),
]

/** Adds the chart-of-accounts entries to the command palette; returns the remover. */
export function registerAccountsCommands(): () => void {
  return registerCommands(accountsCommands)
}
