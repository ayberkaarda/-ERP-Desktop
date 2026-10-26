import { ClipboardList, ListPlus } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { INV_OPEN } from '../documents/permissions'

/** Palette entries for stock counts. */
export function countsCommands(): Command[] {
  return [
    {
      id: 'inventory.counts',
      group: 'navigation',
      icon: ClipboardList,
      permission: INV_OPEN.documents,
      title: (t) => t('nav.counts', { ns: 'inventoryDocs' }),
      keywords: () => ['stock count', 'stok sayımı', 'sayım', 'envanter sayımı'],
      run: ({ navigate }) => navigate('/inventory/counts'),
    },
    {
      id: 'inventory.counts.new',
      group: 'actions',
      icon: ListPlus,
      permission: INV_OPEN.newDocument,
      title: (t) => t('palette.newCount', { ns: 'inventoryDocs' }),
      keywords: () => ['new stock count', 'yeni sayım', 'sayım başlat'],
      run: ({ navigate }) => navigate('/inventory/counts/new'),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerCountsCommands(): () => void {
  return registerCommands(countsCommands())
}
