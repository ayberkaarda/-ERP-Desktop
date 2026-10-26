import { CalendarPlus, CalendarRange } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import { navCommand } from '../shared/commandUtils'
import { ACC_ACCESS, ACC_PERMISSIONS } from '../shared/permissions'

export const fiscalCommands: readonly Command[] = [
  navCommand(
    'fiscal-years',
    '/accounting/fiscal-years',
    'fiscalYears',
    ACC_ACCESS.fiscalYears,
    CalendarRange,
    ['mali yıl', 'hesap dönemi', 'fiscal year', 'yıl sonu', 'year end'],
  ),
  navCommand(
    'fiscal-years-new',
    '/accounting/fiscal-years?new=1',
    'fiscalYearNew',
    ACC_PERMISSIONS.periods.manage,
    CalendarPlus,
    ['yeni mali yıl', 'new fiscal year'],
    'actions',
  ),
]

/** Adds the fiscal year entries to the command palette; returns the remover. */
export function registerFiscalCommands(): () => void {
  return registerCommands(fiscalCommands)
}
