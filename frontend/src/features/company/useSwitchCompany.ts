import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'

/**
 * Switches the active company. Every cached query was fetched with the previous X-Company-Id,
 * so inactive ones are dropped and active ones refetched under the new header.
 */
export function useSwitchCompany() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useCallback(
    (id: string) => {
      const { activeCompanyId, companies, setActiveCompany } = useCompanyStore.getState()
      const next = companies.find((c) => c.id === id)
      if (!next || id === activeCompanyId) return
      setActiveCompany(id)
      queryClient.removeQueries({ type: 'inactive' })
      void queryClient.invalidateQueries()
      platform.notify.info(t('company.switched', { name: next.name }))
    },
    [queryClient, t],
  )
}
