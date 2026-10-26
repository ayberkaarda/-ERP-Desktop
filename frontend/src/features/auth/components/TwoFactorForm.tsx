import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { isApiError } from '@/platform'
import { authApi } from '../api/auth'
import { errorMessage } from '../errors'
import { useFieldError } from '../hooks/useFieldError'
import { recoverySchema, totpSchema, type TwoFactorValues } from '../schemas/twoFactor'
import { FormAlert } from './AuthFrame'
import { FormField } from './FormField'

interface TwoFactorFormProps {
  email: string
  onVerified: () => Promise<void>
  /** Back to credentials, optionally explaining why (expired challenge). */
  onCancel: (reason?: string) => void
}

type Mode = 'totp' | 'recovery'

export function TwoFactorForm({ email, onVerified, onCancel }: TwoFactorFormProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('totp')
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.015em]">{t('auth.twoFactor.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {mode === 'totp'
          ? t('auth.twoFactor.subtitle', { email })
          : t('auth.twoFactor.recoverySubtitle')}
      </p>
      {/* Remount per mode so each input starts empty with its own rules. */}
      <CodeForm key={mode} mode={mode} onVerified={onVerified} onCancel={onCancel} />
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="link"
          className="text-xs"
          onClick={() => setMode(mode === 'totp' ? 'recovery' : 'totp')}
        >
          {mode === 'totp' ? t('auth.twoFactor.useRecovery') : t('auth.twoFactor.useTotp')}
        </Button>
        <Button type="button" variant="link" className="text-xs" onClick={() => onCancel()}>
          {t('auth.twoFactor.back')}
        </Button>
      </div>
    </div>
  )
}

function CodeForm({
  mode,
  onVerified,
  onCancel,
}: {
  mode: Mode
  onVerified: () => Promise<void>
  onCancel: (reason?: string) => void
}) {
  const { t } = useTranslation()
  const fieldError = useFieldError()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<TwoFactorValues>({
    resolver: zodResolver(mode === 'totp' ? totpSchema : recoverySchema),
    defaultValues: { code: '' },
  })

  const onSubmit = handleSubmit(async ({ code }) => {
    setFormError(null)
    const value = code.replace(/\s+/g, '')
    try {
      await authApi.verifyTwoFactor(mode === 'totp' ? { code: value } : { recovery_code: value })
      await onVerified()
    } catch (error) {
      if (!isApiError(error)) {
        setFormError(errorMessage(error, t))
        return
      }
      if (error.code === 'INVALID_TWO_FACTOR_CODE' || error.status === 422) {
        setError('code', { type: 'server', message: errorMessage(error, t) })
        setFocus('code', { shouldSelect: true })
        return
      }
      if (error.status === 401) {
        // The pending login expired server side; start over.
        onCancel(t('auth.errors.challengeExpired'))
        return
      }
      setFormError(errorMessage(error, t))
    }
  })

  const totp = mode === 'totp'
  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="mt-8 space-y-5">
      <FormAlert message={formError} />
      <FormField
        id="two-factor-code"
        label={totp ? t('auth.twoFactor.code') : t('auth.twoFactor.recoveryCode')}
        autoComplete={totp ? 'one-time-code' : 'off'}
        inputMode={totp ? 'numeric' : 'text'}
        maxLength={totp ? 6 : 64}
        autoCapitalize="none"
        spellCheck={false}
        autoFocus
        className="font-code tracking-[0.2em]"
        hint={totp ? t('auth.twoFactor.codeHint') : t('auth.twoFactor.recoveryHint')}
        error={fieldError(errors.code)}
        {...register('code')}
      />
      <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? t('auth.twoFactor.verifying') : t('auth.twoFactor.verify')}
      </Button>
    </form>
  )
}
