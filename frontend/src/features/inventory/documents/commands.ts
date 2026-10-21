import { ArrowLeftRight, FileInput, FileOutput, Files } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { INV_OPEN } from './permissions'

/** Palette entries for stock documents; each is hidden unless its permission is granted. */
export function documentsCommands(): Command[] {
  return [
    {
      id: 'inventory.documents',
      group: 'navigation',
      icon: Files,
      permission: INV_OPEN.documents,
      title: (t) => t('nav.documents', { ns: 'inventoryDocs' }),
      keywords: () => ['stock documents', 'stok fişi', 'depo fişi', 'giriş', 'çıkış', 'irsaliye'],
      run: ({ navigate }) => navigate('/inventory/documents'),
    },
    {
      id: 'inventory.documents.newReceipt',
      group: 'actions',
      icon: FileInput,
      permission: INV_OPEN.newDocument,
      title: (t) => t('palette.newReceipt', { ns: 'inventoryDocs' }),
      keywords: () => ['goods receipt', 'stok girişi', 'giriş fişi', 'mal kabul'],
      run: ({ navigate }) => navigate('/inventory/documents/new?type=receipt'),
    },
    {
      id: 'inventory.documents.newIssue',
      group: 'actions',
      icon: FileOutput,
      permission: INV_OPEN.newDocument,
      title: (t) => t('palette.newIssue', { ns: 'inventoryDocs' }),
      keywords: () => ['goods issue', 'stok çıkışı', 'çıkış fişi', 'sarf'],
      run: ({ navigate }) => navigate('/inventory/documents/new?type=issue'),
    },
    {
      id: 'inventory.documents.newTransfer',
      group: 'actions',
      icon: ArrowLeftRight,
      permission: INV_OPEN.newDocument,
      title: (t) => t('palette.newTransfer', { ns: 'inventoryDocs' }),
      keywords: () => ['transfer', 'depolar arası transfer', 'sevk', 'virman'],
      run: ({ navigate }) => navigate('/inventory/documents/new?type=transfer'),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerDocumentsCommands(): () => void {
  return registerCommands(documentsCommands())
}
