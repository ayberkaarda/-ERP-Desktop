import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, useIntlLocale } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { EmptyState } from './EmptyState'

/** One row of GET /logs/audit (spatie activitylog). */
export interface AuditEntry {
  id: string
  event: string | null
  description?: string | null
  causer: { id: string; name: string } | null
  /** ISO instant. */
  created_at: string
  properties?: {
    attributes?: Record<string, unknown>
    old?: Record<string, unknown>
  } | null
}

interface AuditTrailProps {
  entries: AuditEntry[]
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  hasMore?: boolean
  onLoadMore?: () => void
  /** Translated labels for attribute keys; unknown keys are shown as-is. */
  fieldLabels?: Record<string, string>
  formatValue?: (field: string, value: unknown) => string
  className?: string
}

const KNOWN_EVENTS = ['created', 'updated', 'deleted'] as const

function defaultFormat(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function changes(entry: AuditEntry) {
  const after = entry.properties?.attributes ?? {}
  const before = entry.properties?.old ?? {}
  const keys = [...new Set([...Object.keys(after), ...Object.keys(before)])]
  return keys.map((key) => ({ key, before: before[key], after: after[key] }))
}

export function AuditTrail({
  entries,
  loading = false,
  error = false,
  onRetry,
  hasMore = false,
  onLoadMore,
  fieldLabels = {},
  formatValue,
  className,
}: AuditTrailProps) {
  const { t } = useTranslation('common')
  const locale = useIntlLocale()
  const show = (field: string, value: unknown) =>
    (formatValue ? formatValue(field, value) : defaultFormat(value)) || t('audit.emptyValue')

  if (error) {
    return (
      <div role="alert" className="space-y-2 py-6 text-center text-sm">
        <p>{t('states.errorBody')}</p>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('actions.retry')}
          </Button>
        )}
      </div>
    )
  }
  if (!loading && entries.length === 0) return <EmptyState compact description={t('audit.empty')} />

  return (
    <section
      aria-label={t('audit.title')}
      aria-busy={loading}
      className={cn('space-y-3', className)}
    >
      <ol className="space-y-3">
        {entries.map((entry) => {
          const event = KNOWN_EVENTS.find((e) => e === entry.event) ?? 'other'
          const rows = changes(entry)
          return (
            <li key={entry.id} className="rounded-md border border-border bg-surface p-3">
              <p className="text-sm">
                <span className="font-medium">{entry.causer?.name ?? t('audit.system')}</span>{' '}
                {t(`audit.event.${event}`)}
                {entry.description && entry.description !== entry.event && (
                  <span className="text-muted-foreground"> · {entry.description}</span>
                )}
              </p>
              <time className="text-xs text-muted-foreground" dateTime={entry.created_at}>
                {formatDateTime(entry.created_at, locale)}
              </time>
              {rows.length > 0 && (
                <table className="mt-2 w-full text-table">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-1 pr-3 font-medium">
                        {t('audit.field')}
                      </th>
                      <th scope="col" className="py-1 pr-3 font-medium">
                        {t('audit.before')}
                      </th>
                      <th scope="col" className="py-1 font-medium">
                        {t('audit.after')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key} className="border-t border-border align-top">
                        <th scope="row" className="py-1 pr-3 text-left font-medium">
                          {fieldLabels[row.key] ?? row.key}
                        </th>
                        <td className="py-1 pr-3 break-all text-muted-foreground line-through decoration-danger/50">
                          {event === 'created' ? '' : show(row.key, row.before)}
                        </td>
                        <td className="py-1 break-all">
                          {event === 'deleted' ? '' : show(row.key, row.after)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          )
        })}
        {loading &&
          Array.from({ length: 3 }, (_, i) => (
            <li key={`skeleton-${i}`}>
              <Skeleton className="h-16" />
            </li>
          ))}
      </ol>
      {hasMore && onLoadMore && !loading && (
        <Button variant="secondary" size="sm" onClick={onLoadMore}>
          {t('audit.loadMore')}
        </Button>
      )}
    </section>
  )
}
