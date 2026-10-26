import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { AuthFrame, FormAlert } from '../components/AuthFrame'
import { CredentialsForm } from '../components/CredentialsForm'
import { TwoFactorForm } from '../components/TwoFactorForm'
import { PASSWORD_CHANGE_PATH, loadSession, safeRedirect } from '../session'

type Step =
  { kind: 'credentials'; notice?: string | undefined } | { kind: 'twoFactor'; email: string }

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [step, setStep] = useState<Step>({ kind: 'credentials' })
  const [email, setEmail] = useState('')

  const from = safeRedirect((location.state as { from?: unknown } | null)?.from)

  async function finish() {
    const user = await loadSession()
    if (!user) {
      setStep({ kind: 'credentials', notice: t('auth.errors.generic') })
      return
    }
    await navigate(user.mustChangePassword ? PASSWORD_CHANGE_PATH : from, { replace: true })
  }

  return (
    <AuthFrame>
      {step.kind === 'credentials' ? (
        <>
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">{t('auth.login.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('auth.login.subtitle')}</p>
          {step.notice && (
            <div className="mt-6">
              <FormAlert message={step.notice} />
            </div>
          )}
          <CredentialsForm
            defaultEmail={email}
            onSignedIn={finish}
            onTwoFactor={(value) => {
              setEmail(value)
              setStep({ kind: 'twoFactor', email: value })
            }}
          />
        </>
      ) : (
        <TwoFactorForm
          email={step.email}
          onVerified={finish}
          onCancel={(reason) => setStep({ kind: 'credentials', notice: reason })}
        />
      )}
    </AuthFrame>
  )
}
