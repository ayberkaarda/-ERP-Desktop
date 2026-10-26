import { BarChart3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { PageHeader } from '@/components/shared/PageHeader'
import { usePermissionContext, hasPermission } from '@/lib/permissions'
import { REPORTS_BASE } from '../../invoices/kit/links'
import { REPORTS } from '../definitions'

/** Cards of the sales reports the user may open. */
export function SalesReportsHubPage() {
  const { t } = useTranslation('sales-reports')
  const ctx = usePermissionContext()
  const visible = REPORTS.filter((r) => hasPermission(ctx, r.permission))
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('hub.title')}
        description={t('hub.description')}
        breadcrumbs={[{ label: t('hub.sales') }, { label: t('hub.title') }]}
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((r) => (
          <li key={r.slug}>
            <Link
              to={`${REPORTS_BASE}/${r.slug}`}
              className="flex h-full gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-primary/50 hover:bg-surface-sunken focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none"
            >
              <BarChart3 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="space-y-1">
                <span className="block font-medium">{t(`report.${r.id}.title`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(`report.${r.id}.description`)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
