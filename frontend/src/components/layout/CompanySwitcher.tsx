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

export function CompanySwitcher() {
  const { t } = useTranslation()
  const companies = useCompanyStore((s) => s.companies)
  const setActive = useCompanyStore((s) => s.setActiveCompany)
  const active = useActiveCompany()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-9 max-w-72 items-center gap-2.5 rounded-md border border-border bg-surface px-2.5 text-left shadow-xs hover:bg-surface-sunken"
        aria-label={t('topbar.switchCompany')}
      >
        <span className="grid size-6 place-items-center rounded-sm bg-primary-soft text-primary-soft-foreground">
          <Building2 className="size-3.5" />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block text-2xs text-muted-foreground">{t('topbar.company')}</span>
          <span className="block truncate text-[0.8125rem] font-medium">{active?.name ?? '—'}</span>
        </span>
        <ChevronsUpDown className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>{t('topbar.switchCompany')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={active?.id ?? ''} onValueChange={setActive}>
          {companies.map((c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id} className="h-auto py-1.5">
              <span className="min-w-0">
                <span className="block truncate">{c.name}</span>
                <span className="font-code block text-2xs text-muted-foreground">
                  {t('topbar.taxNumber', { value: c.taxNumber })}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
