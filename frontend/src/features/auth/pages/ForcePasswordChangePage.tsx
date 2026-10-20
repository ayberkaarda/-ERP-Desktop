import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth'
import { AuthFrame } from '../components/AuthFrame'
import { ChangePasswordForm } from '../components/ChangePasswordForm'
import { logout } from '../session'

/** Shown while the account carries must_change_password; every other route redirects here. */
export function ForcePasswordChangePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const email = useAuthStore((s) => s.user?.email ?? '')

  return (
    <AuthFrame>
      <h1 className="text-2xl font-semibold tracking-[-0.015em]">
        {t('auth.password.forceTitle')}
      </h1>
      <p className="mt-1 mb-8 text-sm text-muted-foreground">{t('auth.password.forceBody')}</p>
      <ChangePasswordForm
        email={email}
        submitLabel={t('auth.password.forceSubmit')}
        onChanged={() => navigate('/', { replace: true })}
      />
      <Button
        type="button"
        variant="link"
        className="mt-6 self-start text-xs"
        onClick={() => {
          void logout().then(() => navigate('/login', { replace: true }))
        }}
      >
        {t('topbar.signOut')}
      </Button>
    </AuthFrame>
  )
}
