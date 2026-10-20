import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Copy, ShieldCheck, ShieldOff } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isApiError, platform } from '@/platform'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '../api/auth'
import type { TwoFactorSetup } from '../api/types'
import { errorMessage } from '../errors'
import { qrImageSrc } from '../qr'
import { useFieldError } from '../hooks/useFieldError'
import { totpSchema, type TwoFactorValues } from '../schemas/twoFactor'
import { FormAlert } from './AuthFrame'
import { FormField } from './FormField'

export function TwoFactorCard() {
  const { t } = useTranslation()
  const enabled = useAuthStore((s) => s.user?.twoFactorEnabled ?? false)
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [disableOpen, setDisableOpen] = useState(false)

  const start = useMutation({
    mutationFn: authApi.setupTwoFactor,
    onSuccess: (r) => setSetup(r.data),
    onError: (e) => platform.notify.error(errorMessage(e, t)),
  })

  return (
    <Card>
      <CardHeader className="justify-between">
        <div>
          <CardTitle>{t('security.twoFactor.title')}</CardTitle>
          <CardDescription>{t('security.twoFactor.description')}</CardDescription>
        </div>
        <Badge tone={enabled ? 'success' : 'neutral'}>
          {enabled ? <ShieldCheck /> : <ShieldOff />}
          {enabled ? t('security.twoFactor.on') : t('security.twoFactor.off')}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {recoveryCodes ? (
          <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />
        ) : setup ? (
          <SetupStep
            setup={setup}
            onCancel={() => setSetup(null)}
            onConfirmed={(codes) => {
              setSetup(null)
              setRecoveryCodes(codes)
              useAuthStore.getState().updateUser({ twoFactorEnabled: true })
            }}
          />
        ) : enabled ? (
          <Button variant="secondary" onClick={() => setDisableOpen(true)}>
            {t('security.twoFactor.disable')}
          </Button>
        ) : (
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            {start.isPending ? t('common.loading') : t('security.twoFactor.enable')}
          </Button>
        )}
      </CardContent>
      <DisableDialog open={disableOpen} onOpenChange={setDisableOpen} />
    </Card>
  )
}

function SetupStep({
  setup,
  onCancel,
  onConfirmed,
}: {
  setup: TwoFactorSetup
  onCancel: () => void
  onConfirmed: (codes: string[]) => void
}) {
  const { t } = useTranslation()
  const fieldError = useFieldError()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TwoFactorValues>({
    resolver: zodResolver(totpSchema),
    defaultValues: { code: '' },
  })

  const onSubmit = handleSubmit(async ({ code }) => {
    setFormError(null)
    try {
      const r = await authApi.confirmTwoFactor(code)
      onConfirmed(r.data.recovery_codes)
    } catch (error) {
      const message = errorMessage(error, t)
      if (isApiError(error) && error.status === 422) {
        setError('code', { type: 'server', message })
      } else setFormError(message)
    }
  })

  return (
    <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
      <img
        src={qrImageSrc(setup.qr_svg)}
        alt={t('security.twoFactor.qrAlt')}
        className="size-44 rounded-md border border-border bg-white p-2"
      />
      <div className="min-w-0 space-y-4">
        <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
          <li>{t('security.twoFactor.step1')}</li>
          <li>{t('security.twoFactor.step2')}</li>
        </ol>
        <div className="space-y-1">
          <p className="text-xs font-medium">{t('security.twoFactor.manualKey')}</p>
          <code className="font-code block rounded-sm bg-surface-sunken px-2 py-1 text-xs break-all">
            {setup.secret}
          </code>
        </div>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <FormAlert message={formError} />
          <FormField
            id="setup-code"
            label={t('auth.twoFactor.code')}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            className="font-code max-w-40 tracking-[0.2em]"
            error={fieldError(errors.code)}
            {...register('code')}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {t('security.twoFactor.confirm')}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation()
  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      platform.notify.success(t('security.twoFactor.copied'))
    } catch {
      platform.notify.error(t('security.twoFactor.copyFailed'))
    }
  }
  return (
    <div className="space-y-3">
      <p role="alert" className="text-sm font-medium text-warning-soft-foreground">
        {t('security.twoFactor.recoveryOnce')}
      </p>
      <ul
        aria-label={t('security.twoFactor.recoveryTitle')}
        className="font-code grid grid-cols-2 gap-1 rounded-md border border-border bg-surface-sunken p-3 text-sm"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => void copy()}>
          <Copy />
          {t('security.twoFactor.copy')}
        </Button>
        <Button onClick={onDone}>{t('security.twoFactor.saved')}</Button>
      </div>
    </div>
  )
}

const disableSchema = z.object({ password: z.string().min(1, 'auth.validation.currentRequired') })

function DisableDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const fieldError = useFieldError()
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof disableSchema>>({
    resolver: zodResolver(disableSchema),
    defaultValues: { password: '' },
  })

  const onSubmit = handleSubmit(async ({ password }) => {
    try {
      await authApi.disableTwoFactor(password)
      reset()
      useAuthStore.getState().updateUser({ twoFactorEnabled: false })
      platform.notify.success(t('security.twoFactor.disabled'))
      onOpenChange(false)
    } catch (error) {
      setError('password', { type: 'server', message: errorMessage(error, t) })
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent closeLabel={t('common.close')}>
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('security.twoFactor.disableTitle')}</DialogTitle>
            <DialogDescription>{t('security.twoFactor.disableBody')}</DialogDescription>
          </DialogHeader>
          <FormField
            id="disable-password"
            type="password"
            label={t('auth.password.current')}
            autoComplete="current-password"
            error={fieldError(errors.password)}
            {...register('password')}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={isSubmitting}>
              {t('security.twoFactor.disable')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
