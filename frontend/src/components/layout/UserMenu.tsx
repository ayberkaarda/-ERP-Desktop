import { Languages, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SUPPORTED_LANGUAGES } from '@/lib/i18n'

export function UserMenu() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('topbar.userMenu')}
        className="grid size-8 place-items-center rounded-full bg-sidebar text-2xs font-semibold text-sidebar-active-foreground ring-2 ring-surface hover:ring-border-strong"
      >
        DK
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="normal-case tracking-normal">
          <span className="block text-sm font-medium text-foreground">Demo Kullanıcı</span>
          <span className="block text-xs font-normal">demo@keystone.test</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages />
            {t('topbar.language')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-36">
            <DropdownMenuRadioGroup
              value={i18n.resolvedLanguage ?? 'tr'}
              onValueChange={(lng) => void i18n.changeLanguage(lng)}
            >
              {SUPPORTED_LANGUAGES.map((lng) => (
                <DropdownMenuRadioItem key={lng} value={lng}>
                  {t(`language.${lng}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate('/login')}>
          <LogOut />
          {t('topbar.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
