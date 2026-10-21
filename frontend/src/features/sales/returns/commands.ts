import { RotateCcw } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { RETURNS_BASE } from '../invoices/kit/links'
import { SALES_OPEN } from '../invoices/kit/permissions'

/** Palette entry for sales returns (new returns start from an invoice). */
export function salesReturnsCommands(): Command[] {
  return [
    {
      id: 'sales.returns',
      group: 'navigation',
      icon: RotateCcw,
      permission: SALES_OPEN.returns,
      title: (t) => t('nav.returns', { ns: 'sales-docs' }),
      keywords: () => ['return', 'sales return', 'iade', 'satış iadesi', 'iade faturası'],
      run: ({ navigate }) => navigate(RETURNS_BASE),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerSalesReturnsCommands(): () => void {
  return registerCommands(salesReturnsCommands())
}
