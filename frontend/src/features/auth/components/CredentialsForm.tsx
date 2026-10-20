import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
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
import { isApiError } from '@/platform'
import { authApi } from '../api/auth'
import { errorMessage, serverFieldErrors } from '../errors'
import { useFieldError } from '../hooks/useFieldError'
import { loginSchema, type LoginValues } from '../schemas/login'
import { FormAlert } from './AuthFrame'
import { FormField } from './FormField'

interface CredentialsFormProps {
  defaultEmail?: string
  onSignedIn: () => Promise<void>
  onTwoFactor: (email: string) => void
}

export function CredentialsForm({
  defaultEmail = '',
  onSignedIn,
  onTwoFactor,
}: CredentialsFormProps) {
  const { t } = useTranslation()
  const fieldError = useFieldError()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: defaultEmail, password: '', remember: true },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const res = await authApi.login(values)
      // The password is not kept in form state past the request.
      resetField('password')
      if (res.data.two_factor_required) onTwoFactor(values.email)
      else await onSignedIn()
    } catch (error) {
      if (isApiError(error) && error.code === 'TWO_FACTOR_REQUIRED') {
        resetField('password')
        onTwoFactor(values.email)
        return
      }
      const fields = serverFieldErrors(error)
      let mapped = false
      for (const name of ['email', 'password'] as const) {
        const message = fields[name]
        if (message) {
          setError(name, { type: 'server', message })
          mapped = true
        }
      }
      if (!mapped) setFormError(errorMessage(error, t))
    }
  })

  return (
    <form
      noValidate
      onSubmit={(e) => void onSubmit(e)}
      className="mt-8 space-y-5"
      aria-label={t('auth.login.title')}
    >
      <FormAlert message={formError} />
      <FormField
        id="email"
        label={t('auth.login.email')}
        type="email"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="ad.soyad@sirket.com.tr"
        error={fieldError(errors.email)}
        {...register('email')}
      />
      <FormField
        id="password"
        label={t('auth.login.password')}
        type="password"
        autoComplete="current-password"
        error={fieldError(errors.password)}
        labelAside={<ForgotPassword />}
        {...register('password')}
      />

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
  )
}

function ForgotPassword() {
  const { t } = useTranslation()
  return (
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
  )
}
