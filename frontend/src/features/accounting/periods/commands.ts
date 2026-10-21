import { CalendarClock } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { navCommand } from '../shared/commandUtils'
import { ACC_PERMISSIONS } from '../shared/permissions'

export const periodsCommands: readonly Command[] = [
  navCommand(
    'periods',
    '/accounting/periods',
    'periods',
    ACC_PERMISSIONS.periods.view,
    CalendarClock,
    ['dönem', 'dönem kapanışı', 'period close', 'muhasebe dönemi'],
  ),
]

/** Adds the periods board to the command palette; returns the remover. */
export function registerPeriodsCommands(): () => void {
  return registerCommands(periodsCommands)
}
