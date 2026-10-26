import { WalletCards } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'
import type { Area } from './shared/types'
export function treasuryCommands(): Command[] {
  return [
    ...(['accounts', 'payments', 'transfers', 'instruments', 'banking', 'plans'] as Area[]),
    'reports' as const,
  ].map((area) => ({
    id: `treasury.${area}`,
    group: 'navigation',
    icon: WalletCards,
    permission: `treasury.${area}.view`,
    title: (t) => t(area, { ns: 'treasury' }),
    keywords: () => ['treasury', 'hazine', area],
    run: ({ navigate }) => navigate(`/treasury/${area}`),
  }))
}
export function registerTreasuryCommands() {
  return registerCommands(treasuryCommands())
}
