import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { PageHeader } from '@/components/shared/PageHeader'
import { usePermissionContext, hasPermission } from '@/lib/permissions'
import { REPORTS, REPORTS_BASE } from '../definitions'

/** Index of the inventory reports the user may open. */
export function ReportsHubPage() {
  const { t } = useTranslation('inventoryDocs')
  const ctx = usePermissionContext()
  const visible = REPORTS.filter((r) => hasPermission(ctx, r.permission))
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('reports.hubTitle')}
        description={t('reports.hubDescription')}
        breadcrumbs={[{ label: t('nav.inventory') }, { label: t('reports.hubTitle') }]}
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((r) => (
          <li key={r.slug}>
            <Link
              to={`${REPORTS_BASE}/${r.slug}`}
              className="group flex h-full items-start justify-between gap-3 rounded-lg border border-border bg-surface p-4 transition-colors duration-150 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20"
            >
              <span className="space-y-1">
                <span className="block text-sm font-semibold">{t(`report.${r.id}.title`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(`report.${r.id}.description`)}
                </span>
              </span>
              <ChevronRight
                className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-primary"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
