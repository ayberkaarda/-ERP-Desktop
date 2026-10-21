import { Search, UserPlus, Users } from 'lucide-react'
import { registerCommands, type Command } from '@/features/command-palette/registry'

export function partyCommands(): Command[] {
  return [
    {
      id: 'parties.list',
      group: 'navigation',
      icon: Users,
      permission: 'parties.view',
      title: (t) => t('commands.list', { ns: 'parties' }),
      keywords: () => ['cari', 'müşteri', 'tedarikçi', 'customer', 'supplier', 'party'],
      run: ({ navigate }) => navigate('/parties'),
    },
    {
      id: 'parties.new',
      group: 'actions',
      icon: UserPlus,
      permission: 'parties.create',
      title: (t) => t('commands.new', { ns: 'parties' }),
      keywords: () => ['yeni cari', 'new party', 'create customer', 'create supplier'],
      run: ({ navigate }) => navigate('/parties/new'),
    },
    {
      id: 'parties.search',
      group: 'actions',
      icon: Search,
      permission: 'parties.view',
      title: (t) => t('commands.search', { ns: 'parties' }),
      keywords: () => ['cari ara', 'search party', 'vkn', 'vergi no'],
      run: ({ navigate }) => navigate('/parties?focus=search'),
    },
  ]
}

/** Called once by the app at integration; returns the unregister function. */
export function registerPartyCommands(): () => void {
  return registerCommands(partyCommands())
}
