import { FileCheck2, FilePlus2 } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { SALES_ACCESS } from '../shared/permissions'

/** Palette entries for sales orders; each is hidden unless its permission is granted. */
export function ordersCommands(): Command[] {
  return [
    {
      id: 'sales.orders',
      group: 'navigation',
      icon: FileCheck2,
      permission: SALES_ACCESS.orderList,
      title: (t) => t('palette.list', { ns: 'sales-orders' }),
      keywords: () => [
        'sales orders',
        'sipariş',
        'siparişler',
        'satış siparişi',
        'müşteri siparişi',
      ],
      run: ({ navigate }) => navigate('/sales/orders'),
    },
    {
      id: 'sales.orders.new',
      group: 'actions',
      icon: FilePlus2,
      permission: SALES_ACCESS.orderNew,
      title: (t) => t('palette.new', { ns: 'sales-orders' }),
      keywords: () => ['new order', 'yeni sipariş', 'sipariş oluştur', 'sipariş gir'],
      run: ({ navigate }) => navigate('/sales/orders/new'),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerOrdersCommands(): () => void {
  return registerCommands(ordersCommands())
}
