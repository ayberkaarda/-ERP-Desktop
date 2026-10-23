import { FilePlus, ReceiptText } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { INVOICES_BASE } from './kit/links'
import { PURCH_OPEN } from './kit/permissions'

/** Palette entries for supplier invoices; each is hidden unless its permission is granted. */
export function purchaseInvoicesCommands(): Command[] {
  return [
    {
      id: 'purchasing.invoices',
      group: 'navigation',
      icon: ReceiptText,
      permission: PURCH_OPEN.invoices,
      title: (t) => t('nav.invoices', { ns: 'purchasing-docs' }),
      keywords: () => [
        'supplier invoice',
        'purchase invoice',
        'alış faturası',
        'tedarikçi faturası',
        'borç',
      ],
      run: ({ navigate }) => navigate(INVOICES_BASE),
    },
    {
      id: 'purchasing.invoices.new',
      group: 'actions',
      icon: FilePlus,
      permission: PURCH_OPEN.newInvoice,
      title: (t) => t('palette.newInvoice', { ns: 'purchasing-docs' }),
      keywords: () => ['new supplier invoice', 'yeni alış faturası', 'fatura gir'],
      run: ({ navigate }) => navigate(`${INVOICES_BASE}/new`),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerPurchaseInvoicesCommands(): () => void {
  return registerCommands(purchaseInvoicesCommands())
}
