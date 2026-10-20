import { Building2, ChevronsUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useActiveCompany, useCompanyStore } from '@/stores/company'
import { useCompanyCommands } from '../useCompanyCommands'
import { useSwitchCompany } from '../useSwitchCompany'

export function CompanySwitcher() {
  const { t } = useTranslation()
  const companies = useCompanyStore((s) => s.companies)
  const active = useActiveCompany()
  const switchCompany = useSwitchCompany()
  useCompanyCommands()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 w-full max-w-72 min-w-0 items-center gap-2.5 rounded-md border border-border bg-surface px-2.5 text-left shadow-xs hover:bg-surface-sunken disabled:cursor-default disabled:hover:bg-surface"
        disabled={companies.length === 0}
        aria-label={
          active
            ? t('topbar.switchCompanyCurrent', { name: active.name })
            : t('topbar.switchCompany')
        }
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-primary-soft text-primary-soft-foreground">
          <Building2 className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-2xs text-muted-foreground">{t('topbar.company')}</span>
          <span className="block truncate text-[0.8125rem] font-medium">
            {active?.name ?? t('company.none')}
          </span>
        </span>
        <ChevronsUpDown className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>{t('topbar.switchCompany')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={active?.id ?? ''} onValueChange={switchCompany}>
          {companies.map((c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id} className="h-auto py-1.5">
              <span className="min-w-0">
                <span className="block truncate">{c.name}</span>
                {c.roleNames.length > 0 && (
                  <span className="block truncate text-2xs text-muted-foreground">
                    {c.roleNames.join(', ')}
                  </span>
                )}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
