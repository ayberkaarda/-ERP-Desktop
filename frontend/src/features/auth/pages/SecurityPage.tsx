import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth'
import { ChangePasswordForm } from '../components/ChangePasswordForm'
import { SessionsCard } from '../components/SessionsCard'
import { TwoFactorCard } from '../components/TwoFactorCard'

export function SecurityPage() {
  const { t } = useTranslation()
  const email = useAuthStore((s) => s.user?.email ?? '')
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <PageHeader title={t('security.title')} description={t('security.subtitle')} />
      <div className="space-y-4">
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
      </div>
    </div>
  )
}
