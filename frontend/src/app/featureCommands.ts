import { registerAccountsCommands } from '@/features/accounting/accounts/commands'
import { registerDeterminationCommands } from '@/features/accounting/determination/commands'
import { registerFiscalCommands } from '@/features/accounting/fiscal/commands'
import { registerJournalCommands } from '@/features/accounting/journal/commands'
import { registerPeriodsCommands } from '@/features/accounting/periods/commands'
import { registerReportsCommands } from '@/features/accounting/reports/commands'
import { registerCatalogCommands } from '@/features/catalog/commands'
import { registerPartyCommands } from '@/features/parties/commands'
import { registerReferenceCommands } from '@/features/reference/commands'

let unregister: (() => void) | null = null

/** Adds the feature modules' palette entries; safe to call more than once. */
export function registerFeatureCommands(): () => void {
  if (!unregister) {
    const parts = [
      registerPartyCommands(),
      registerCatalogCommands(),
      registerReferenceCommands(),
      registerAccountsCommands(),
      registerFiscalCommands(),
      registerPeriodsCommands(),
      registerDeterminationCommands(),
      registerJournalCommands(),
      registerReportsCommands(),
    ]
    unregister = () => {
      parts.forEach((off) => off())
      unregister = null
    }
  }
  return unregister
}
