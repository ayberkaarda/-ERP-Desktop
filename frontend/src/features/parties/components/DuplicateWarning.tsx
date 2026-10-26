import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { PartyDuplicate } from '../types'

/** Advisory, non-blocking: announced politely, never steals focus. */
export function DuplicateWarning({ matches }: { matches: PartyDuplicate[] }) {
  const { t } = useTranslation('parties')
  return (
    <div aria-live="polite">
      {matches.length > 0 && (
        <div
          role="status"
          className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground"
        >
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">{t('duplicates.title')}</p>
              <p>{t('duplicates.body')}</p>
              <ul className="space-y-0.5">
                {matches.slice(0, 5).map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-x-2">
                    <Link
                      to={`/parties/${encodeURIComponent(m.id)}`}
                      target="_blank"
                      rel="noopener"
                      className="font-medium underline underline-offset-2 hover:no-underline"
                    >
                      <span className="font-code">{m.code}</span> {m.name}
                    </Link>
                    {m.tax_number && <span className="font-code text-xs">{m.tax_number}</span>}
                    {m.reasons.length > 0 && (
                      <span className="text-xs">
                        (
                        {m.reasons
                          .map((r) =>
                            r === 'tax_number'
                              ? t('duplicates.byTaxNumber')
                              : t('duplicates.byName'),
                          )
                          .join(', ')}
                        )
                      </span>
                    )}
                    {!m.is_active && <span className="text-xs">· {t('duplicates.inactive')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
