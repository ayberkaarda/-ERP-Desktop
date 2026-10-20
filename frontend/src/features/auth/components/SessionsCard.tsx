import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Monitor, Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { platform } from '@/platform'
import { authApi, authKeys, sessionsQuery } from '../api/auth'
import type { ApiSession } from '../api/types'
import { describeAgent } from '../userAgent'
import { errorMessage } from '../errors'

export function SessionsCard() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const sessions = useQuery(sessionsQuery())
  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => {
      platform.notify.success(t('security.sessions.revoked'))
      return queryClient.invalidateQueries({ queryKey: authKeys.sessions })
    },
    onError: (e) => platform.notify.error(errorMessage(e, t)),
  })
  const fmt = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'tr', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('security.sessions.title')}</CardTitle>
          <CardDescription>{t('security.sessions.description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {sessions.isPending ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : sessions.isError ? (
          <div role="alert" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-danger">{errorMessage(sessions.error, t)}</span>
            <Button variant="secondary" size="sm" onClick={() => void sessions.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : sessions.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('security.sessions.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {sessions.data.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                lastActive={formatInstant(fmt, s.last_active_at)}
                pending={revoke.isPending && revoke.variables === s.id}
                onRevoke={() => revoke.mutate(s.id)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function formatInstant(fmt: Intl.DateTimeFormat, value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : fmt.format(d)
}

function SessionRow({
  session,
  lastActive,
  pending,
  onRevoke,
}: {
  session: ApiSession
  lastActive: string
  pending: boolean
  onRevoke: () => void
}) {
  const { t } = useTranslation()
  const agent = describeAgent(session.user_agent)
  const Icon = agent.mobile ? Smartphone : Monitor
  const label = agent.browser
    ? t('security.sessions.agent', { browser: agent.browser, os: agent.os ?? '—' })
    : t('security.sessions.unknownDevice')
  return (
    <li className="flex items-center gap-3 py-3">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{label}</span>
          {session.is_current && <Badge tone="primary">{t('security.sessions.current')}</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('security.sessions.meta', { ip: session.ip_address ?? '—', at: lastActive })}
        </p>
      </div>
      {!session.is_current && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRevoke}
          disabled={pending}
          aria-label={t('security.sessions.revokeLabel', { device: label })}
        >
          {t('security.sessions.revoke')}
        </Button>
      )}
    </li>
  )
}
