import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'

/** DataTable view key (columns, density, sort, page size) of a page for this user and company. */
export function viewKey(
  page: string,
  userId: string | null | undefined,
  companyId: string | null | undefined,
): string | undefined {
  if (!userId || !companyId) return undefined
  return `purchasing.${encodeURIComponent(userId)}.${encodeURIComponent(companyId)}.${page}`
}

export function useScopedViewKey(page: string): string | undefined {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const companyId = useCompanyStore((s) => s.activeCompanyId)
  return viewKey(page, userId, companyId)
}
