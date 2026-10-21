import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { linkTo } from '../links'
import type { DocLink } from '../types'

/** Previous and next documents of the chain (order, deliveries, invoices, returns, postings). */
export function DocLinks({ links }: { links: DocLink[] | undefined }) {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  if (!links || links.length === 0) return null
  return (
    <section
      aria-label={t('links.title')}
      className="rounded-lg border border-border bg-surface p-4 print:hidden"
    >
      <h2 className="mb-2 text-sm font-semibold">{t('links.title')}</h2>
      <ul className="space-y-1 text-sm">
        {links.map((l) => (
          <li key={`${l.type}-${l.id}`} className="flex flex-wrap items-center gap-2">
            {l.relation === 'source' ? (
              <ArrowLeft className="size-3.5 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="text-muted-foreground">{t(`linkType.${l.type}`)}</span>
            <Link to={linkTo(l.type, l.id)} className="font-code text-primary hover:underline">
              {l.number ?? t('links.unnumbered')}
            </Link>
            {l.document_date && (
              <span className="text-xs text-muted-foreground">
                {formatDate(l.document_date, locale)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
