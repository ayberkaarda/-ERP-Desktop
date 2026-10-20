import { Languages, LogOut, ShieldCheck } from 'lucide-react'
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
import { useAuthStore } from '@/stores/auth'
import { logout } from '../session'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]]
  return letters
    .map((p) => (p ? p.charAt(0) : ''))
    .join('')
    .toLocaleUpperCase('tr-TR')
}

export function UserMenu() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('topbar.userMenu')}
        className="grid size-8 place-items-center rounded-full bg-sidebar text-2xs font-semibold text-sidebar-active-foreground ring-2 ring-surface hover:ring-border-strong"
      >
        <span aria-hidden="true">{user ? initials(user.name) : '?'}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="tracking-normal normal-case">
          <span className="block truncate text-sm font-medium text-foreground">{user?.name}</span>
          <span className="block truncate text-xs font-normal">{user?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate('/profile/security')}>
          <ShieldCheck />
          {t('topbar.security')}
        </DropdownMenuItem>
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
        <DropdownMenuItem
          onSelect={() => {
            void logout().then(() => navigate('/login', { replace: true }))
          }}
        >
          <LogOut />
          {t('topbar.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
