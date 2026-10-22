import { ClipboardList, FilePlus2 } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { PURCH_ACCESS } from '../shared/permissions'

/** Palette entries for purchase requests; each is hidden unless its permission is granted. */
export function purchaseRequestsCommands(): Command[] {
  return [
    {
      id: 'purchasing.requests',
      group: 'navigation',
      icon: ClipboardList,
      permission: PURCH_ACCESS.requestList,
      title: (t) => t('palette.requests', { ns: 'purchasing-orders' }),
      keywords: () => ['purchase requests', 'satınalma talebi', 'talep', 'malzeme talebi'],
      run: ({ navigate }) => navigate('/purchasing/requests'),
    },
    {
      id: 'purchasing.requests.new',
      group: 'actions',
      icon: FilePlus2,
      permission: PURCH_ACCESS.requestNew,
      title: (t) => t('palette.newRequest', { ns: 'purchasing-orders' }),
      keywords: () => ['new purchase request', 'yeni talep', 'talep oluştur'],
      run: ({ navigate }) => navigate('/purchasing/requests/new'),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerPurchaseRequestsCommands(): () => void {
  return registerCommands(purchaseRequestsCommands())
}
