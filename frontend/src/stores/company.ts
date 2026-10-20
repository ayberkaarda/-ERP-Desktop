import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CompanySummary {
  id: string
  name: string
  taxNumber: string
  currency: string
}

interface CompanyState {
  companies: CompanySummary[]
  activeCompanyId: string | null
  setActiveCompany: (id: string) => void
}

// Placeholder list until the Organization module serves /companies.
const PLACEHOLDER: CompanySummary[] = [
  {
    id: '0192a000-0000-7000-8000-000000000001',
    name: 'Anadolu Makina A.Ş.',
    taxNumber: '1234567890',
    currency: 'TRY',
  },
  {
    id: '0192a000-0000-7000-8000-000000000002',
    name: 'Ege Dış Ticaret Ltd. Şti.',
    taxNumber: '9876543210',
    currency: 'TRY',
  },
]

export const useCompanyStore = create<CompanyState>()(
  persist(
    (set) => ({
      companies: PLACEHOLDER,
      activeCompanyId: PLACEHOLDER[0]?.id ?? null,
      setActiveCompany: (id) => set({ activeCompanyId: id }),
    }),
    { name: 'keystone.company', partialize: ({ activeCompanyId }) => ({ activeCompanyId }) },
  ),
)

export function useActiveCompany(): CompanySummary | undefined {
  return useCompanyStore((s) => s.companies.find((c) => c.id === s.activeCompanyId))
}
