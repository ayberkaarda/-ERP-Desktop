import { Building2 } from 'lucide-react'
import { useEffect } from 'react'
import { registerCommands } from '@/features/command-palette/registry'
import { useCompanyStore } from '@/stores/company'
import { useSwitchCompany } from './useSwitchCompany'

/** Offers "switch to <company>" in the command palette for every other membership. */
export function useCompanyCommands() {
  const companies = useCompanyStore((s) => s.companies)
  const activeId = useCompanyStore((s) => s.activeCompanyId)
  const switchCompany = useSwitchCompany()

  useEffect(
    () =>
      registerCommands(
        companies
          .filter((c) => c.id !== activeId)
          .map((c) => ({
            id: `company.switch.${c.id}`,
            group: 'company' as const,
            icon: Building2,
            title: (t) => t('company.switchTo', { name: c.name }),
            keywords: () => [c.name, 'company', 'şirket'],
            run: () => switchCompany(c.id),
          })),
      ),
    [companies, activeId, switchCompany],
  )
}
