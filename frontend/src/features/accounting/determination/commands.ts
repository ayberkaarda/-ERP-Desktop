import { Route } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { navCommand } from '../shared/commandUtils'
import { ACC_PERMISSIONS } from '../shared/permissions'

export const determinationCommands: readonly Command[] = [
  navCommand(
    'determination',
    '/accounting/determination',
    'determination',
    ACC_PERMISSIONS.determination.manage,
    Route,
    ['hesap belirleme', 'muhasebe kuralları', 'account determination', 'entegrasyon'],
  ),
]

/** Adds the account determination screen to the command palette; returns the remover. */
export function registerDeterminationCommands(): () => void {
  return registerCommands(determinationCommands)
}
