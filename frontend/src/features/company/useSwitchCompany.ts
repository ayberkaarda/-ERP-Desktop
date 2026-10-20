import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/features/auth/errors'
import { refreshPermissions } from '@/features/auth/session'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'

/**
 * Switches the active company. In-flight requests carry the previous X-Company-Id, so they
 * are cancelled and every cached result is reset before anything renders under the new
 * company. Permissions stay denied until a fresh /auth/me confirms them.
 */
export function useSwitchCompany() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  return useCallback(
    async (id: string) => {
      const { activeCompanyId, companies, setActiveCompany } = useCompanyStore.getState()
      const next = companies.find((c) => c.id === id)
      if (!next || id === activeCompanyId) return
      await queryClient.cancelQueries()
      setActiveCompany(id)
      queryClient.removeQueries({ type: 'inactive' })
      void queryClient.resetQueries()
      try {
        await refreshPermissions()
        platform.notify.info(t('company.switched', { name: next.name }))
      } catch (error) {
        platform.notify.error(t('company.refreshFailed'), { description: errorMessage(error, t) })
      }
    },
    [queryClient, t],
  )
}
