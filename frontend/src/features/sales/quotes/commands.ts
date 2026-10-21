import { FilePlus2, FileText } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { SALES_ACCESS } from '../shared/permissions'

/** Palette entries for quotes; each is hidden unless its permission is granted. */
export function quotesCommands(): Command[] {
  return [
    {
      id: 'sales.quotes',
      group: 'navigation',
      icon: FileText,
      permission: SALES_ACCESS.quoteList,
      title: (t) => t('palette.list', { ns: 'sales-quotes' }),
      keywords: () => ['quotes', 'teklif', 'teklifler', 'satış teklifi', 'proforma'],
      run: ({ navigate }) => navigate('/sales/quotes'),
    },
    {
      id: 'sales.quotes.new',
      group: 'actions',
      icon: FilePlus2,
      permission: SALES_ACCESS.quoteNew,
      title: (t) => t('palette.new', { ns: 'sales-quotes' }),
      keywords: () => ['new quote', 'yeni teklif', 'teklif oluştur', 'teklif ver'],
      run: ({ navigate }) => navigate('/sales/quotes/new'),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerQuotesCommands(): () => void {
  return registerCommands(quotesCommands())
}
