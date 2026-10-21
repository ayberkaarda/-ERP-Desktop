import { FilePlus, Receipt } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { INVOICES_BASE } from './kit/links'
import { SALES_OPEN } from './kit/permissions'

/** Palette entries for sales invoices; each is hidden unless its permission is granted. */
export function salesInvoicesCommands(): Command[] {
  return [
    {
      id: 'sales.invoices',
      group: 'navigation',
      icon: Receipt,
      permission: SALES_OPEN.invoices,
      title: (t) => t('nav.invoices', { ns: 'sales-docs' }),
      keywords: () => ['invoice', 'sales invoice', 'fatura', 'satış faturası', 'alacak'],
      run: ({ navigate }) => navigate(INVOICES_BASE),
    },
    {
      id: 'sales.invoices.new',
      group: 'actions',
      icon: FilePlus,
      permission: SALES_OPEN.newInvoice,
      title: (t) => t('palette.newInvoice', { ns: 'sales-docs' }),
      keywords: () => ['new invoice', 'yeni fatura', 'fatura kes'],
      run: ({ navigate }) => navigate(`${INVOICES_BASE}/new`),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerSalesInvoicesCommands(): () => void {
  return registerCommands(salesInvoicesCommands())
}
