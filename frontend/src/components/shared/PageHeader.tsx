import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

export interface Breadcrumb {
  label: string
  to?: string
}

interface PageHeaderProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  /** Links need a router; plain labels render without one. */
  breadcrumbs?: Breadcrumb[]
  /** Inline next to the title, e.g. a StatusBadge on a document page. */
  meta?: ReactNode
}

export function PageHeader({ title, description, actions, breadcrumbs, meta }: PageHeaderProps) {
  const { t } = useTranslation('common')
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 pb-5">
      <div className="min-w-0 space-y-0.5">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label={t('pageHeader.breadcrumbs')}>
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {breadcrumbs.map((b, i) => (
                <li key={`${b.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden="true">/</span>}
                  {b.to ? (
                    <Link to={b.to} className="hover:text-foreground hover:underline">
                      {b.label}
                    </Link>
                  ) : (
                    <span aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined}>
                      {b.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
          {meta}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
