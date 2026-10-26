import { PackageCheck } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { RECEIPTS_BASE } from '../invoices/kit/links'
import { PURCH_OPEN } from '../invoices/kit/permissions'

/** Palette entries for goods receipts; each is hidden unless its permission is granted. */
export function purchaseReceiptsCommands(): Command[] {
  return [
    {
      id: 'purchasing.receipts',
      group: 'navigation',
      icon: PackageCheck,
      permission: PURCH_OPEN.receipts,
      title: (t) => t('nav.receipts', { ns: 'purchasing-docs' }),
      keywords: () => ['goods receipt', 'grn', 'mal kabul', 'giriş irsaliyesi', 'teslim alma'],
      run: ({ navigate }) => navigate(RECEIPTS_BASE),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerPurchaseReceiptsCommands(): () => void {
  return registerCommands(purchaseReceiptsCommands())
}
