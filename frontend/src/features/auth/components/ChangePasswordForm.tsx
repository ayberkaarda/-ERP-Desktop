import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { platform } from '@/platform'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '../api/auth'
import { errorMessage, serverFieldErrors } from '../errors'
import { useFieldError } from '../hooks/useFieldError'
import { PASSWORD_MIN } from '../schemas/login'
import { changePasswordSchema, type ChangePasswordValues } from '../schemas/password'
import { FormAlert } from './AuthFrame'
import { FormField } from './FormField'

const FIELDS = ['current_password', 'password', 'password_confirmation'] as const

interface ChangePasswordFormProps {
  /** Hidden username field lets password managers attach the new password to the account. */
  email: string
  onChanged?: () => void | Promise<void>
  submitLabel?: string
}

export function ChangePasswordForm({ email, onChanged, submitLabel }: ChangePasswordFormProps) {
  const { t } = useTranslation()
  const fieldError = useFieldError()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', password: '', password_confirmation: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await authApi.changePassword(values)
      reset()
      useAuthStore.getState().updateUser({ mustChangePassword: false })
      platform.notify.success(t('auth.password.changed'))
      await onChanged?.()
    } catch (error) {
      const fields = serverFieldErrors(error)
      let mapped = false
      for (const name of FIELDS) {
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
      className="space-y-4"
      aria-label={t('auth.password.title')}
    >
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <FormAlert message={formError} />
      <FormField
        id="current-password"
        type="password"
        label={t('auth.password.current')}
        autoComplete="current-password"
        error={fieldError(errors.current_password)}
        {...register('current_password')}
      />
      <FormField
        id="new-password"
        type="password"
        label={t('auth.password.new')}
        autoComplete="new-password"
        hint={t('auth.password.rule', { count: PASSWORD_MIN })}
        error={fieldError(errors.password)}
        {...register('password')}
      />
      <FormField
        id="confirm-password"
        type="password"
        label={t('auth.password.confirm')}
        autoComplete="new-password"
        error={fieldError(errors.password_confirmation)}
        {...register('password_confirmation')}
      />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? t('auth.password.saving') : (submitLabel ?? t('auth.password.submit'))}
      </Button>
    </form>
  )
}
