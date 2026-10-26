import { Undo2 } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { RETURNS_BASE } from '../invoices/kit/links'
import { PURCH_OPEN } from '../invoices/kit/permissions'

/** Palette entries for purchase returns; each is hidden unless its permission is granted. */
export function purchaseReturnsCommands(): Command[] {
  return [
    {
      id: 'purchasing.returns',
      group: 'navigation',
      icon: Undo2,
      permission: PURCH_OPEN.returns,
      title: (t) => t('nav.returns', { ns: 'purchasing-docs' }),
      keywords: () => ['purchase return', 'debit note', 'alış iadesi', 'iade', 'borç dekontu'],
      run: ({ navigate }) => navigate(RETURNS_BASE),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerPurchaseReturnsCommands(): () => void {
  return registerCommands(purchaseReturnsCommands())
}
