import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { KeystoneLogo } from '@/components/brand/Logo'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SUPPORTED_LANGUAGES } from '@/lib/i18n'
import { ArchBackdrop } from './ArchBackdrop'

/** Split sign-in layout shared by login, two-factor and forced password change. */
export function AuthFrame({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation()
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <section className="flex flex-col px-6 py-6 sm:px-12">
        <header className="flex items-center justify-between">
          <KeystoneLogo className="h-8 text-foreground" />
          <ThemeToggle />
        </header>

        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          {children}
        </main>

        <footer className="flex items-center justify-between gap-4 text-xs text-subtle-foreground">
          <span>{t('auth.login.footer')}</span>
          <Select
            value={i18n.resolvedLanguage ?? 'tr'}
            onValueChange={(lng) => void i18n.changeLanguage(lng)}
          >
            <SelectTrigger
              aria-label={t('topbar.language')}
              className="h-control-sm w-32 text-xs shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LANGUAGES.map((lng) => (
                <SelectItem key={lng} value={lng}>
                  {t(`language.${lng}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </footer>
      </section>

      <aside className="ks-backdrop relative hidden overflow-hidden lg:block">
        <ArchBackdrop />
        <div className="relative flex h-full flex-col justify-end p-14 text-sidebar-active-foreground">
          <p className="mb-4 text-2xs font-medium tracking-[0.14em] text-sidebar-muted uppercase">
            {t('app.tagline')}
          </p>
          <h2 className="max-w-md text-[2rem] leading-[1.15] font-semibold tracking-[-0.02em]">
            {t('auth.login.heroTitle')}
          </h2>
          <p className="mt-4 max-w-md text-sm text-sidebar-foreground">
            {t('auth.login.heroBody')}
          </p>
        </div>
      </aside>
    </div>
  )
}

/** Inline, announced form-level error. */
export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p
      role="alert"
      className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground"
    >
      {message}
    </p>
  )
}
