import { FilePlus2, Truck } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { DELIVERIES_BASE } from '../invoices/kit/links'
import { SALES_OPEN } from '../invoices/kit/permissions'

/** Palette entries for dispatch notes; each is hidden unless its permission is granted. */
export function salesDeliveriesCommands(): Command[] {
  return [
    {
      id: 'sales.deliveries',
      group: 'navigation',
      icon: Truck,
      permission: SALES_OPEN.deliveries,
      title: (t) => t('nav.deliveries', { ns: 'sales-docs' }),
      keywords: () => ['delivery', 'dispatch note', 'irsaliye', 'sevkiyat', 'sevk irsaliyesi'],
      run: ({ navigate }) => navigate(DELIVERIES_BASE),
    },
    {
      id: 'sales.deliveries.new',
      group: 'actions',
      icon: FilePlus2,
      permission: SALES_OPEN.newDelivery,
      title: (t) => t('palette.newDelivery', { ns: 'sales-docs' }),
      keywords: () => ['new delivery', 'yeni irsaliye', 'doğrudan sevk'],
      run: ({ navigate }) => navigate(`${DELIVERIES_BASE}/new`),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerSalesDeliveriesCommands(): () => void {
  return registerCommands(salesDeliveriesCommands())
}
