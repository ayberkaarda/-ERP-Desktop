import { Boxes } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { navCommand } from './lib/commandUtils'
import { INV_ACCESS } from './lib/permissions'

export const stockCommands: readonly Command[] = [
  navCommand('stock', '/inventory/stock', 'stock', INV_ACCESS.stock, Boxes, [
    'stok durumu',
    'eldeki stok',
    'mevcut',
    'stock status',
    'on hand',
    'available',
  ]),
]

/** Adds the stock status entry to the command palette; returns the remover. */
export function registerStockCommands(): () => void {
  return registerCommands(stockCommands)
}
