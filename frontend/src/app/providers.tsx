import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import i18n from '@/lib/i18n'
import { queryClient as defaultClient } from '@/lib/queryClient'
import { useApplyTheme } from './theme'

interface ProvidersProps {
  children: ReactNode
  queryClient?: QueryClient
}

export function Providers({ children, queryClient = defaultClient }: ProvidersProps) {
  useApplyTheme()
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={400}>
          {children}
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}
