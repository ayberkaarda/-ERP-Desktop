import { Plus, Warehouse } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { navCommand } from '../stock/lib/commandUtils'
import { INV_ACCESS, INV_PERMISSIONS } from '../stock/lib/permissions'

export const warehousesCommands: readonly Command[] = [
  navCommand(
    'warehouses',
    '/inventory/warehouses',
    'warehouses',
    INV_ACCESS.warehouses,
    Warehouse,
    ['depolar', 'ambar', 'raf', 'lokasyon', 'warehouses', 'locations', 'bins'],
  ),
  navCommand(
    'warehouses-new',
    '/inventory/warehouses?new=1',
    'warehouseNew',
    INV_PERMISSIONS.warehouses.manage,
    Plus,
    ['yeni depo', 'new warehouse'],
    'actions',
  ),
]

/** Adds the warehouse entries to the command palette; returns the remover. */
export function registerWarehousesCommands(): () => void {
  return registerCommands(warehousesCommands)
}
