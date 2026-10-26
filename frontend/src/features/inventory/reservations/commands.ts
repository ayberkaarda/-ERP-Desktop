import { Lock } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { INV_OPEN } from '../documents/permissions'

export function reservationsCommands(): Command[] {
  return [
    {
      id: 'inventory.reservations',
      group: 'navigation',
      icon: Lock,
      permission: INV_OPEN.reservations,
      title: (t) => t('nav.reservations', { ns: 'inventoryDocs' }),
      keywords: () => ['reservations', 'rezervasyon', 'ayrılmış stok', 'stok ayırma'],
      run: ({ navigate }) => navigate('/inventory/reservations'),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerReservationsCommands(): () => void {
  return registerCommands(reservationsCommands())
}
