import { Barcode, PackageSearch } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { navCommand } from '../stock/lib/commandUtils'
import { INV_ACCESS } from '../stock/lib/permissions'

export const lotsCommands: readonly Command[] = [
  navCommand('lots', '/inventory/lots', 'lots', INV_ACCESS.stock, PackageSearch, [
    'parti',
    'lot',
    'son kullanma',
    'skt',
    'izlenebilirlik',
    'expiry',
    'trace',
  ]),
  navCommand('serials', '/inventory/serials', 'serials', INV_ACCESS.stock, Barcode, [
    'seri numarası',
    'seri no',
    'serial number',
  ]),
]

/** Adds the lot and serial entries to the command palette; returns the remover. */
export function registerLotsCommands(): () => void {
  return registerCommands(lotsCommands)
}
