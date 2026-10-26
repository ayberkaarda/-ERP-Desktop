import { ArrowLeftRight } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { navCommand } from '../stock/lib/commandUtils'
import { INV_ACCESS } from '../stock/lib/permissions'

export const movementsCommands: readonly Command[] = [
  navCommand('movements', '/inventory/movements', 'movements', INV_ACCESS.stock, ArrowLeftRight, [
    'stok hareketleri',
    'hareket',
    'giriş çıkış',
    'stock movements',
    'ledger',
  ]),
]

/** Adds the stock ledger entry to the command palette; returns the remover. */
export function registerMovementsCommands(): () => void {
  return registerCommands(movementsCommands)
}
