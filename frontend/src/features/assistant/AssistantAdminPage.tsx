import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { assistantApi } from './api'
import { useAssistantStatus } from './useAssistantStatus'

export function AssistantAdminPage() {
  const user = useAuthStore((s) => s.user?.id)
  const company = useCompanyStore((s) => s.activeCompanyId)
  return <AdminContent key={`${user}:${company}`} />
}
function AdminContent() {
  const { t, i18n } = useTranslation('assistant')
  const company = useCompanyStore((s) => s.activeCompanyId)
  const user = useAuthStore((s) => s.user?.id)
  const today = new Date().toLocaleDateString('en-CA')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [page, setPage] = useState(1)
  const status = useAssistantStatus()
  const validDates = !!from && !!to && from <= to
  const usage = useQuery({
    queryKey: ['assistant', user, company, 'usage', from, to, page],
    queryFn: ({ signal }) => assistantApi.usage(from, to, page, signal),
    enabled:
      !!status.data?.enabled && status.data.configured && status.data.can_admin && validDates,
    retry: false,
  })
  const format = new Intl.NumberFormat(i18n.resolvedLanguage)
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <PageHeader title={t('adminTitle')} description={t('adminDescription')} />
      {status.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : status.isError ? (
        <p role="alert">
          {t('requestError')}{' '}
          <button className="underline" onClick={() => void status.refetch()}>
            {t('retry')}
          </button>
        </p>
      ) : !status.data.can_admin ? (
        <p role="alert">{t('accessError')}</p>
      ) : (
        <>
          <section className="mb-6 space-y-3 rounded-md border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">{t('setupTitle')}</h2>
            <p className="text-sm text-muted-foreground">
              {status.data.enabled && status.data.configured
                ? t('enabled')
                : status.data.enabled
                  ? t('notConfigured')
                  : t('disabled')}
            </p>
            <p className="text-sm text-muted-foreground">{t('setupDetail')}</p>
            <code className="block whitespace-pre-wrap rounded bg-surface-sunken p-3 text-xs">
              {'ASSISTANT_ENABLED=true\nASSISTANT_PROVIDER=…\nASSISTANT_MODEL=…'}
            </code>
            <p className="text-xs text-muted-foreground">{t('setupSecrets')}</p>
            <p className="text-xs text-muted-foreground">{t('privacyDetail')}</p>
            {status.data.enabled && status.data.configured && (
              <p className="text-xs">
                {status.data.provider} / {status.data.model}
              </p>
            )}
          </section>
          {status.data.enabled && status.data.configured && (
            <section className="space-y-4">
              <h2 className="text-base font-semibold">{t('usage')}</h2>
              <div className="flex flex-wrap gap-3">
                <label className="space-y-1 text-xs">
                  <span className="block">{t('dateFrom')}</span>
                  <input
                    type="date"
                    value={from}
                    onChange={(event) => {
                      setFrom(event.target.value)
                      setPage(1)
                    }}
                    className="rounded border border-border bg-surface p-2 text-sm"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="block">{t('dateTo')}</span>
                  <input
                    type="date"
                    value={to}
                    onChange={(event) => {
                      setTo(event.target.value)
                      setPage(1)
                    }}
                    className="rounded border border-border bg-surface p-2 text-sm"
                  />
                </label>
              </div>
              {!validDates && (
                <p role="alert" className="text-sm text-danger">
                  {t('invalidDates')}
                </p>
              )}
              {usage.isFetching && (
                <p role="status" className="text-sm text-muted-foreground">
                  {t('loading')}
                </p>
              )}
              {usage.isError && (
                <p role="alert" className="text-sm text-danger">
                  {t('requestError')}{' '}
                  <button className="underline" onClick={() => void usage.refetch()}>
                    {t('retry')}
                  </button>
                </p>
              )}
              {usage.data && (
                <>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-left text-sm">
                      <caption className="sr-only">{t('usage')}</caption>
                      <thead className="bg-surface-sunken text-xs">
                        <tr>
                          {(
                            [
                              'date',
                              'user',
                              'inputTokens',
                              'outputTokens',
                              'reservedTokens',
                              'requests',
                              'failures',
                            ] as const
                          ).map((key) => (
                            <th key={key} className="whitespace-nowrap p-3 font-medium">
                              {t(key)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {usage.data.data.map((row) => (
                          <tr key={`${row.date}:${row.user_id}`} className="border-t border-border">
                            <td className="whitespace-nowrap p-3">{row.date}</td>
                            <td className="p-3 font-mono text-xs">{row.user_id}</td>
                            {[
                              row.input_tokens,
                              row.output_tokens,
                              row.reserved_tokens,
                              row.requests,
                              row.failures,
                            ].map((value, index) => (
                              <td key={index} className="p-3 tabular-nums">
                                {format.format(value)}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {usage.data.data.length === 0 && (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-muted-foreground">
                              {t('noUsage')}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={page <= 1 || usage.isFetching}
                      onClick={() => setPage((value) => value - 1)}
                    >
                      {t('previous')}
                    </Button>
                    <span className="text-xs">
                      {page} / {usage.data.meta?.pagination?.last_page ?? 1}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={
                        page >= (usage.data.meta?.pagination?.last_page ?? 1) || usage.isFetching
                      }
                      onClick={() => setPage((value) => value + 1)}
                    >
                      {t('next')}
                    </Button>
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
