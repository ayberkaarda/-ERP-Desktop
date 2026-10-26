import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '@/lib/storage'

export interface CompanySummary {
  id: string
  name: string
  roleNames: string[]
  /** Not served by /auth/me yet; screens fall back to TRY. */
  currency?: string
}

interface CompanyState {
  companies: CompanySummary[]
  activeCompanyId: string | null
  /** True once the last membership was revoked while signed in. */
  accessRevoked: boolean
  setAccessRevoked: (revoked: boolean) => void
  setActiveCompany: (id: string) => void
  /** Replaces memberships from /auth/me, keeping the remembered company when still allowed. */
  setCompanies: (companies: CompanySummary[]) => void
  clear: () => void
}

export const useCompanyStore = create<CompanyState>()(
  persist(
    (set, get) => ({
      companies: [],
      activeCompanyId: null,
      accessRevoked: false,
      setAccessRevoked: (accessRevoked) => set({ accessRevoked }),
      setActiveCompany: (id) => {
        if (get().companies.some((c) => c.id === id)) set({ activeCompanyId: id })
      },
      setCompanies: (companies) => {
        const current = get().activeCompanyId
        const keep = companies.some((c) => c.id === current)
        set({
          companies,
          activeCompanyId: keep ? current : (companies[0]?.id ?? null),
          ...(companies.length > 0 ? { accessRevoked: false } : {}),
        })
      },
      // The remembered company id survives logout so the next sign-in lands in the same place.
      clear: () => set({ companies: [], accessRevoked: false }),
    }),
    {
      name: 'keystone.company',
      storage: safeJSONStorage,
      partialize: ({ activeCompanyId }) => ({ activeCompanyId }),
    },
  ),
)

export function useActiveCompany(): CompanySummary | undefined {
  return useCompanyStore((s) => s.companies.find((c) => c.id === s.activeCompanyId))
}
