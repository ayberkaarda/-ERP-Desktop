import {
  Activity,
  Languages,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import { changeTheme } from '@/app/theme'
import i18n, { SUPPORTED_LANGUAGES } from '@/lib/i18n'
import { signOut } from '@/features/auth/signOut'
import type { Command } from './registry'

/** Navigation for existing routes plus theme, language and sign-out. */
export function coreCommands(): Command[] {
  return [
    {
      id: 'nav.dashboard',
      group: 'navigation',
      icon: LayoutDashboard,
      title: (t) => t('nav.dashboard'),
      keywords: () => ['home', 'panel', 'dashboard'],
      run: ({ navigate }) => navigate('/'),
    },
    {
      id: 'nav.health',
      group: 'navigation',
      icon: Activity,
      title: (t) => t('nav.health'),
      keywords: () => ['health', 'status', 'api'],
      run: ({ navigate }) => navigate('/system/health'),
    },
    {
      id: 'nav.security',
      group: 'navigation',
      icon: ShieldCheck,
      title: (t) => t('security.title'),
      keywords: (t) => [t('auth.password.title'), t('security.twoFactor.title'), '2fa'],
      run: ({ navigate }) => navigate('/profile/security'),
    },
    ...(['light', 'dark', 'system'] as const).map((theme): Command => ({
      id: `theme.${theme}`,
      group: 'preferences',
      icon: theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor,
      title: (t) => t('palette.theme', { name: t(`theme.${theme}`) }),
      keywords: () => ['theme', 'tema'],
      run: () => changeTheme(theme),
    })),
    ...SUPPORTED_LANGUAGES.map((lng): Command => ({
      id: `language.${lng}`,
      group: 'preferences',
      icon: Languages,
      title: (t) => t('palette.language', { name: t(`language.${lng}`) }),
      keywords: () => ['language', 'dil', lng],
      run: () => void i18n.changeLanguage(lng),
    })),
    {
      id: 'auth.signOut',
      group: 'actions',
      icon: LogOut,
      title: (t) => t('topbar.signOut'),
      keywords: () => ['logout', 'sign out', 'çıkış'],
      run: async ({ navigate }) => {
        await signOut(navigate)
      },
    },
  ]
}
