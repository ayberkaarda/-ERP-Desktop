import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { assistantApi } from './api'

export function useAssistantStatus() {
  const userId = useAuthStore((s) => s.user?.id)
  const authenticated = useAuthStore((s) => s.status === 'authenticated')
  const fresh = useAuthStore((s) => s.permissionsState === 'fresh')
  const companyId = useCompanyStore((s) => s.activeCompanyId)
  const revoked = useCompanyStore((s) => s.accessRevoked)
  return useQuery({
    queryKey: ['assistant', userId, companyId, 'status'],
    queryFn: ({ signal }) => assistantApi.status(signal),
    enabled: !!userId && !!companyId && authenticated && fresh && !revoked,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  })
}
