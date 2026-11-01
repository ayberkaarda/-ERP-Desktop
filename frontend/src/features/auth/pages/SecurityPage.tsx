import { useTranslation } from 'react-i18next'
import { appExtensions } from '@/app/extensions'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { platform } from '@/platform'
import { useAuthStore } from '@/stores/auth'
import { ChangePasswordForm } from '../components/ChangePasswordForm'
import { SessionsCard } from '../components/SessionsCard'
import { TwoFactorCard } from '../components/TwoFactorCard'

export function SecurityPage() {
  const { t } = useTranslation()
  const email = useAuthStore((s) => s.user?.email ?? '')
  // A runtime that manages credentials elsewhere has none of these endpoints.
  const inline = platform.session?.passwordChange !== 'external'
  const { SecurityExtras } = appExtensions
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <PageHeader title={t('security.title')} description={t('security.subtitle')} />
      <div className="space-y-4">
        {inline ? (
          <>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{t('auth.password.title')}</CardTitle>
                  <CardDescription>{t('security.passwordDescription')}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="max-w-sm">
                <ChangePasswordForm email={email} />
              </CardContent>
            </Card>
            <TwoFactorCard />
            <SessionsCard />
          </>
        ) : null}
        {SecurityExtras ? <SecurityExtras /> : null}
      </div>
    </div>
  )
}
