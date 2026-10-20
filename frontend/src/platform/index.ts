import i18n from '@/lib/i18n'
import { useCompanyStore } from '@/stores/company'
import { createWebPlatform } from './web'

export * from './types'

// Single runtime selection point; the desktop shell will provide its own adapter here.
export const platform = createWebPlatform({
  getCompanyId: () => useCompanyStore.getState().activeCompanyId,
  getLocale: () => i18n.language,
})
