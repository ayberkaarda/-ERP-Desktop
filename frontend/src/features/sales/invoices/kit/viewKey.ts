import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'

/**
 * Table view key of one list for one user in one company ("sales.invoices.<user>.<company>");
 * null without both, so the view then lives in memory only and is never shared.
 */
export function scopedViewKey(
  key: string,
  userId: string | null | undefined,
  companyId: string | null | undefined,
): string | null {
  if (!userId || !companyId) return null
  return `${key}.${encodeURIComponent(userId)}.${encodeURIComponent(companyId)}`
}

export function useScopedViewKey(key: string): string | null {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const companyId = useCompanyStore((s) => s.activeCompanyId)
  return scopedViewKey(key, userId, companyId)
}

/** ISO code of the active company's currency (local totals); TRY until /auth/me serves it. */
export function useCompanyCurrency(): string {
  return useCompanyStore(
    (s) => s.companies.find((c) => c.id === s.activeCompanyId)?.currency ?? 'TRY',
  )
}
