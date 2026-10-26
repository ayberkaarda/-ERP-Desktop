import { BookText, Scale, ScrollText } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'

/** Palette entries for the accounting reports (accounting.reports.view). */
export function reportsCommands(): Command[] {
  const permission = 'accounting.reports.view'
  return [
    {
      id: 'accounting.reports.trialBalance',
      group: 'navigation',
      icon: Scale,
      permission,
      title: (t) => t('nav.trialBalance', { ns: 'accountingJournal' }),
      keywords: () => ['trial balance', 'mizan', 'geçici mizan'],
      run: ({ navigate }) => navigate('/accounting/reports/trial-balance'),
    },
    {
      id: 'accounting.reports.generalLedger',
      group: 'navigation',
      icon: BookText,
      permission,
      title: (t) => t('nav.generalLedger', { ns: 'accountingJournal' }),
      keywords: () => ['general ledger', 'büyük defter', 'hesap ekstresi', 'muavin'],
      run: ({ navigate }) => navigate('/accounting/reports/general-ledger'),
    },
    {
      id: 'accounting.reports.journalBook',
      group: 'navigation',
      icon: ScrollText,
      permission,
      title: (t) => t('nav.journalBook', { ns: 'accountingJournal' }),
      keywords: () => ['journal book', 'yevmiye defteri', 'defter'],
      run: ({ navigate }) => navigate('/accounting/reports/journal-book'),
    },
  ]
}

/** Called once at startup by the shell; returns the unregister function. */
export function registerReportsCommands(): () => void {
  return registerCommands(reportsCommands())
}
