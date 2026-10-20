import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { healthQuery } from '../api/health'

export function HealthPage() {
  const { t, i18n } = useTranslation()
  const { data, error, isPending, isFetching, refetch, dataUpdatedAt, errorUpdatedAt } =
    useQuery(healthQuery())

  const ok = data?.data.status === 'ok'
  const checkedAt = Math.max(dataUpdatedAt, errorUpdatedAt)

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <PageHeader
        title={t('health.title')}
        description={t('health.subtitle')}
        actions={
          <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn(isFetching && 'animate-spin')} />
            {t('health.recheck')}
          </Button>
        }
      />
      <Card>
        <dl className="divide-y divide-border text-sm">
          <Row label={t('health.endpoint')}>
            <span className="font-code">GET /api/v1/health</span>
          </Row>
          <Row label={t('health.status')}>
            {isPending ? (
              <Badge tone="neutral">{t('health.checking')}</Badge>
            ) : ok ? (
              <Badge tone="success">{t('health.ok')}</Badge>
            ) : (
              <span className="flex items-center gap-2">
                <Badge tone="danger">{t('health.down')}</Badge>
                {error && (
                  <span className="font-code text-xs text-muted-foreground">{error.message}</span>
                )}
              </span>
            )}
          </Row>
          <Row label={t('health.checkedAt')}>
            {checkedAt ? (
              formatDateTime(new Date(checkedAt), i18n.resolvedLanguage)
            ) : (
              <Skeleton className="h-4 w-32" />
            )}
          </Row>
        </dl>
      </Card>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-1 px-5 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}
