import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router'
import { signOut } from '@/features/auth/signOut'

/** Shown instead of the page when the user no longer belongs to any company. */
export function AccessRevoked() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div role="alert" className="grid min-h-full place-items-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <ShieldAlert className="mx-auto size-8 text-danger" aria-hidden />
        <h1 className="text-lg font-semibold">{t('company.revokedTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('company.revokedBody')}</p>
        <Button
          variant="secondary"
          onClick={() => void signOut((to) => navigate(to, { replace: true }))}
        >
          {t('topbar.signOut')}
        </Button>
      </div>
    </div>
  )
}
