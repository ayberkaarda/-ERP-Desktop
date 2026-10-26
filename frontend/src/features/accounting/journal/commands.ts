import { BookOpenText, Plus } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'

/** Palette entries for journal entries; each is hidden unless its permission is granted. */
export function journalCommands(): Command[] {
  return [
    {
      id: 'accounting.journalEntries',
      group: 'navigation',
      icon: BookOpenText,
      permission: 'accounting.entries.view',
      title: (t) => t('nav.entries', { ns: 'accountingJournal' }),
      keywords: () => ['journal', 'entry', 'yevmiye', 'fiş', 'mahsup', 'muhasebe fişi'],
      run: ({ navigate }) => navigate('/accounting/journal-entries'),
    },
    {
      id: 'accounting.journalEntries.new',
      group: 'actions',
      icon: Plus,
      permission: ['accounting.entries.view', 'accounting.entries.create'],
      title: (t) => t('palette.newEntry', { ns: 'accountingJournal' }),
      keywords: () => ['new journal entry', 'yeni fiş', 'mahsup fişi', 'yevmiye kaydı'],
      run: ({ navigate }) => navigate('/accounting/journal-entries/new'),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerJournalCommands(): () => void {
  return registerCommands(journalCommands())
}
