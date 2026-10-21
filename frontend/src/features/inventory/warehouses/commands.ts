import { Warehouse } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { navCommand } from '../stock/lib/commandUtils'
import { INV_ACCESS } from '../stock/lib/permissions'

// Creating warehouses and locations belongs to Reference (its own palette entries); here only
// the stock view of warehouses.
export const warehousesCommands: readonly Command[] = [
  navCommand(
    'warehouses',
    '/inventory/warehouses',
    'warehouses',
    INV_ACCESS.warehouses,
    Warehouse,
    ['depolar', 'ambar', 'raf', 'lokasyon', 'rezervasyon', 'warehouses', 'locations', 'bins'],
  ),
]

/** Adds the warehouse entries to the command palette; returns the remover. */
export function registerWarehousesCommands(): () => void {
  return registerCommands(warehousesCommands)
}
