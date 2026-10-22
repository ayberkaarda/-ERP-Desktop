import { FileCheck2, FilePlus2 } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { PURCH_ACCESS } from '../shared/permissions'

/** Palette entries for purchase orders; each is hidden unless its permission is granted. */
export function purchaseOrdersCommands(): Command[] {
  return [
    {
      id: 'purchasing.orders',
      group: 'navigation',
      icon: FileCheck2,
      permission: PURCH_ACCESS.orderList,
      title: (t) => t('palette.orders', { ns: 'purchasing-orders' }),
      keywords: () => ['purchase orders', 'satınalma siparişi', 'satın alma', 'tedarikçi siparişi'],
      run: ({ navigate }) => navigate('/purchasing/orders'),
    },
    {
      id: 'purchasing.orders.new',
      group: 'actions',
      icon: FilePlus2,
      permission: PURCH_ACCESS.orderNew,
      title: (t) => t('palette.newOrder', { ns: 'purchasing-orders' }),
      keywords: () => ['new purchase order', 'yeni satınalma siparişi', 'sipariş ver'],
      run: ({ navigate }) => navigate('/purchasing/orders/new'),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerPurchaseOrdersCommands(): () => void {
  return registerCommands(purchaseOrdersCommands())
}
