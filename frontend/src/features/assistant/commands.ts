import { MessageSquare } from 'lucide-react'
import { registerCommands } from '@/features/command-palette/registry'
export function registerAssistantCommands() {
  return registerCommands([
    {
      id: 'assistant.settings',
      group: 'navigation',
      icon: MessageSquare,
      permission: 'assistant.usage.view',
      title: (t) => t('adminTitle', { ns: 'assistant' }),
      keywords: () => ['assistant', 'asistan'],
      run: ({ navigate }) => navigate('/system/assistant'),
    },
  ])
}
