import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/PageHeader'
import { isApiError } from '@/platform'
import { formatDecimalDisplay } from '@/lib/money'
import { useIntlLocale } from '@/lib/datetime'
import { edocumentsApi } from './api'
import { useEdocScope, useEdocT } from './hooks'
import type { DocumentStatus, Page } from './types'
export const control =
  'h-9 w-full rounded-md border border-border bg-surface px-3 text-sm disabled:opacity-50'
export function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-md border border-border bg-surface p-4">
      {children}
    </section>
  )
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
export function ErrorNotice({ error, reload }: { error: unknown; reload?: () => void }) {
  const t = useEdocT()
  if (!error) return null
  return (
    <div
      role="alert"
      className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger-soft-foreground"
    >
      <p>
        {isApiError(error) && error.status === 409
          ? t('conflict')
          : error instanceof Error
            ? error.message
            : t('error')}
      </p>
      {isApiError(error) && (
        <ul className="mt-2 list-disc pl-4">
          {Object.entries(error.fields).flatMap(([key, messages]) =>
            messages.map((message, i) => <li key={`${key}:${i}`}>{message}</li>),
          )}
        </ul>
      )}
      {reload && (
        <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={reload}>
          {t('reload')}
        </Button>
      )}
    </div>
  )
}
export function StatusBadge({ status }: { status: DocumentStatus }) {
  const t = useEdocT()
  return (
    <Badge
      tone={
        ['accepted', 'delivered'].includes(status)
          ? 'success'
          : ['failed', 'rejected', 'invalid'].includes(status)
            ? 'danger'
            : 'neutral'
      }
    >
      {t(`status_${status}`)}
    </Badge>
  )
}
export function Amount({ value, currency }: { value: string; currency: string }) {
  const locale = useIntlLocale()
  return (
    <span className="whitespace-nowrap tabular-nums">
      {formatDecimalDisplay(value, { locale, minFraction: 2, maxFraction: 4 })} {currency}
    </span>
  )
}
export function SandboxNotice() {
  const t = useEdocT()
  const scope = useEdocScope()
  const status = useQuery({
    queryKey: ['edocuments', scope.key, 'status'],
    queryFn: ({ signal }) => edocumentsApi.status(signal),
    enabled: scope.enabled,
    retry: false,
  })
  return (
    <>
      <div
        role="note"
        className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm"
      >
        <Badge tone="warning">{t('sandbox')}</Badge>
        <p>{t('sandboxDescription')}</p>
      </div>
      <ErrorNotice error={status.error} reload={() => void status.refetch()} />
      {status.data && !status.data.available && (
        <p role="alert" className="text-sm text-danger">
          {t('providerUnavailable')}
        </p>
      )}
      {status.data && !status.data.validation_available && (
        <p role="status" className="text-sm text-warning">
          {t('validatorUnavailable')}
        </p>
      )}
    </>
  )
}
export function Header({ title, actions }: { title: string; actions?: ReactNode }) {
  const t = useEdocT()
  return (
    <PageHeader
      title={title}
      description={t('description')}
      actions={actions}
      breadcrumbs={[{ label: t('title'), to: '/edocuments/outbox' }, { label: title }]}
    />
  )
}
export function Tabs() {
  const t = useEdocT()
  return (
    <nav
      aria-label={t('navigation')}
      className="flex flex-wrap gap-4 border-b border-border pb-3 text-sm"
    >
      <Link className="text-primary hover:underline" to="/edocuments/outbox">
        {t('outbox')}
      </Link>
      <Link className="text-primary hover:underline" to="/edocuments/inbox">
        {t('inbox')}
      </Link>
      <Link className="text-primary hover:underline" to="/edocuments/taxpayers">
        {t('taxpayers')}
      </Link>
    </nav>
  )
}
export function Pagination({
  data,
  page,
  setPage,
  busy = false,
}: {
  data?: Page<unknown>
  page: number
  setPage: (page: number) => void
  busy?: boolean
}) {
  const t = useEdocT()
  const last = data?.meta.pagination.last_page ?? 1
  return (
    <div className="flex items-center justify-end gap-3 text-xs">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={page <= 1 || busy}
        onClick={() => setPage(page - 1)}
      >
        {t('previous')}
      </Button>
      <span>
        {page} / {last}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={page >= last || busy}
        onClick={() => setPage(page + 1)}
      >
        {t('next')}
      </Button>
    </div>
  )
}
