import { FileQuestion, FilePlus2 } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { PURCH_ACCESS } from '../shared/permissions'

/** Palette entries for purchase rfqs; each is hidden unless its permission is granted. */
export function purchaseRfqsCommands(): Command[] {
  return [
    {
      id: 'purchasing.rfqs',
      group: 'navigation',
      icon: FileQuestion,
      permission: PURCH_ACCESS.rfqList,
      title: (t) => t('palette.rfqs', { ns: 'purchasing-orders' }),
      keywords: () => ['request for quotation', 'rfq', 'teklif talebi', 'tedarikçi teklifi'],
      run: ({ navigate }) => navigate('/purchasing/rfqs'),
    },
    {
      id: 'purchasing.rfqs.new',
      group: 'actions',
      icon: FilePlus2,
      permission: PURCH_ACCESS.rfqNew,
      title: (t) => t('palette.newRfq', { ns: 'purchasing-orders' }),
      keywords: () => ['new rfq', 'yeni teklif talebi'],
      run: ({ navigate }) => navigate('/purchasing/rfqs/new'),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerPurchaseRfqsCommands(): () => void {
  return registerCommands(purchaseRfqsCommands())
}
