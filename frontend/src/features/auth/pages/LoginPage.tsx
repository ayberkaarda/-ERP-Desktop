import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { KeystoneLogo } from '@/components/brand/Logo'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SUPPORTED_LANGUAGES } from '@/lib/i18n'
import { platform } from '@/platform'
import { ArchBackdrop } from '../components/ArchBackdrop'
import { loginSchema, PASSWORD_MIN, type LoginValues } from '../schemas/login'

export function LoginPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', remember: true },
  })

  const onSubmit = handleSubmit(async () => {
    // Sanctum login lands with the Identity module; until then the form only validates.
    await new Promise((r) => setTimeout(r, 300))
    platform.notify.info(t('auth.login.pending'))
    await navigate('/')
  })

  const fieldError = (key: string | undefined) =>
    key ? t(key as 'auth.validation.emailRequired', { count: PASSWORD_MIN }) : undefined

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <section className="flex flex-col px-6 py-6 sm:px-12">
        <header className="flex items-center justify-between">
          <KeystoneLogo className="h-8 text-foreground" />
          <ThemeToggle />
        </header>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">{t('auth.login.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('auth.login.subtitle')}</p>

          <form noValidate onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('auth.login.email')}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                placeholder="ad.soyad@sirket.com.tr"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...register('email')}
              />
              {errors.email && (
                <p id="email-error" className="text-xs text-danger">
                  {fieldError(errors.email.message)}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t('auth.login.password')}</Label>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button type="button" variant="link" className="h-auto text-xs">
                      {t('auth.login.forgot')}
                    </Button>
                  </DialogTrigger>
                  <DialogContent closeLabel={t('common.close')}>
                    <DialogHeader>
                      <DialogTitle>{t('auth.forgot.title')}</DialogTitle>
                      <DialogDescription>{t('auth.forgot.body')}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="secondary">{t('common.close')}</Button>
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : undefined}
                {...register('password')}
              />
              {errors.password && (
                <p id="password-error" className="text-xs text-danger">
                  {fieldError(errors.password.message)}
                </p>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground select-none">
              <input
                type="checkbox"
                className="size-4 rounded-sm accent-(--primary)"
                {...register('remember')}
              />
              {t('auth.login.remember')}
            </label>

            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t('auth.login.submitting') : t('auth.login.submit')}
            </Button>
          </form>
        </div>

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
