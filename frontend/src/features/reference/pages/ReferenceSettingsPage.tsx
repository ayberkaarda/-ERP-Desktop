import { BaseCurrencyCard } from '../components/BaseCurrencyCard'
import { PageShell } from '../components/PageShell'
import { useRefT } from '../i18n'

export function ReferenceSettingsPage() {
  const t = useRefT()
  return (
    <PageShell title={t('settings.title')} description={t('settings.subtitle')}>
      <div className="max-w-3xl space-y-4">
        <BaseCurrencyCard />
      </div>
    </PageShell>
  )
}
