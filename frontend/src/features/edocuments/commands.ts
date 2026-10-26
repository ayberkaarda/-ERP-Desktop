import { Files } from 'lucide-react'
import { registerCommands } from '@/features/command-palette/registry'
export function registerEdocumentsCommands() {
  return registerCommands(
    (['outbox', 'inbox', 'taxpayers'] as const).map((area) => ({
      id: `edocuments.${area}`,
      group: 'navigation' as const,
      icon: Files,
      permission: 'edocuments.view',
      title: (t) => t(area, { ns: 'edocuments' }),
      keywords: () => ['e-fatura', 'e-arşiv', 'e-irsaliye', 'UBL', area],
      run: ({ navigate }) => navigate(`/edocuments/${area}`),
    })),
  )
}
