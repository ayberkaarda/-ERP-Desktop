import { CalendarRange, FileWarning, Lock, LockOpen, PauseCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, toIsoDate, useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { AccountingShell, LoadError, NativeSelect } from '../../shared/components'
import { useAccT } from '../../shared/i18n'
import { PeriodStatusBadge } from '../../shared/PeriodStatusBadge'
import { ACC_PERMISSIONS } from '../../shared/permissions'
import { useFiscalYears, usePeriods } from '../../shared/queries'
import { SavedViewsMenu } from '../../shared/SavedViewsMenu'
import { PERIOD_STATUSES, type AccountingPeriod, type PeriodAction } from '../../shared/types'
import { PeriodActionDialog } from '../components/PeriodActionDialog'
import { allowedActions, periodLabel, pickDefaultYear } from '../lib/periods'

const LAST_YEAR_KEY = 'keystone.accounting.periods.year'
const VIEW_KEY = 'accounting.periods'

function readLastYear(): string | null {
  try {
    return window.localStorage.getItem(LAST_YEAR_KEY)
  } catch {
    return null
  }
}

function rememberYear(id: string) {
  try {
    window.localStorage.setItem(LAST_YEAR_KEY, id)
  } catch {
    // Storage blocked: the URL still carries the year.
  }
}

const ICON: Record<PeriodAction, typeof Lock> = {
  'soft-close': PauseCircle,
  close: Lock,
  reopen: LockOpen,
}
const ACTION_KEY: Record<PeriodAction, string> = {
  'soft-close': 'softClose',
  close: 'close',
  reopen: 'reopen',
}

export function PeriodsBoardPage() {
  const t = useAccT()
  const locale = useIntlLocale()
  const [params, setParams] = useSearchParams()
  const years = useFiscalYears()
  const canClose = usePermission(ACC_PERMISSIONS.periods.close)
  const canReopen = usePermission(ACC_PERMISSIONS.periods.reopen)
  const [dialog, setDialog] = useState<{ period: AccountingPeriod; action: PeriodAction } | null>(
    null,
  )
  const today = toIsoDate(new Date())
  const yearId =
    params.get('year') ?? (years.data ? pickDefaultYear(years.data, today, readLastYear()) : null)
  const year = years.data?.find((y) => y.id === yearId) ?? null
  const periods = usePeriods(year ? year.id : null)
  const status = params.get('status') ?? ''

  useEffect(() => {
    if (yearId) rememberYear(yearId)
  }, [yearId])

  const setParam = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )

  const sorted = useMemo(
    () =>
      [...(periods.data ?? [])]
        .sort((a, b) => a.number - b.number)
        .filter((p) => !status || p.status === status),
    [periods.data, status],
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = { open: 0, soft_closed: 0, closed: 0 }
    for (const p of periods.data ?? []) c[p.status] = (c[p.status] ?? 0) + 1
    return c
  }, [periods.data])

  const canDo = (action: PeriodAction) => (action === 'reopen' ? canReopen : canClose)
  const label = (p: AccountingPeriod) =>
    p.number === 13 ? t('periods.adjustment') : `${p.number} · ${periodLabel(p, locale)}`

  return (
    <AccountingShell
      wide
      title={t('periods.title')}
      description={t('periods.subtitle')}
      actions={
        <SavedViewsMenu
          storageKey={VIEW_KEY}
          current={{ ...(yearId ? { year: yearId } : {}), ...(status ? { status } : {}) }}
          onApply={(v) =>
            setParams(
              (prev) => {
                const next = new URLSearchParams(prev)
                for (const k of ['year', 'status']) {
                  const val = v[k]
                  if (val) next.set(k, val)
                  else next.delete(k)
                }
                return next
              },
              { replace: true },
            )
          }
        />
      }
    >
      {years.isLoading && <Skeleton className="h-10 w-64" aria-label={t('common.loading')} />}
      {years.isError && <LoadError error={years.error} onRetry={() => void years.refetch()} />}
      {years.data?.length === 0 && (
        <EmptyState
          icon={<CalendarRange className="size-10 text-muted-foreground" aria-hidden="true" />}
          title={t('fiscal.empty')}
          description={t('fiscal.emptyBody')}
          action={
            <Button asChild>
              <Link to="/accounting/fiscal-years">{t('common.nav.fiscalYears')}</Link>
            </Button>
          }
        />
      )}
      {years.data && years.data.length > 0 && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <FieldShell label={t('periods.year')} className="w-60">
            {(control) => (
              <NativeSelect
                {...control}
                value={yearId ?? ''}
                options={years.data.map((y) => ({
                  value: y.id,
                  label: `${y.code} · ${t(`periods.status.${y.status}`)}`,
                }))}
                onChange={(e) => setParam('year', e.target.value)}
              />
            )}
          </FieldShell>
          <FieldShell label={t('periods.fields.status')} className="w-44">
            {(control) => (
              <NativeSelect
                {...control}
                value={status}
                emptyLabel={t('common.all')}
                options={PERIOD_STATUSES.map((s) => ({
                  value: s,
                  label: `${t(`periods.status.${s}`)} (${counts[s] ?? 0})`,
                }))}
                onChange={(e) => setParam('status', e.target.value)}
              />
            )}
          </FieldShell>
          {year && (
            <p className="pb-2 text-sm text-muted-foreground">
              {formatDate(year.start_date, locale)} – {formatDate(year.end_date, locale)}
            </p>
          )}
        </div>
      )}
      {year?.status === 'closed' && (
        <p role="status" className="mb-3 rounded-md bg-surface-sunken p-3 text-sm">
          {t('periods.yearClosed')}
        </p>
      )}
      {periods.isLoading && <Skeleton className="h-48 w-full" />}
      {periods.isError && (
        <LoadError error={periods.error} onRetry={() => void periods.refetch()} />
      )}
      {sorted.length > 0 && (
        <ul
          aria-label={t('periods.boardLabel', { code: year?.code ?? '' })}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {sorted.map((p) => {
            const isCurrent = p.start_date <= today && today <= p.end_date
            const drafts = p.draft_entries_count ?? 0
            const actions = year?.status === 'closed' ? [] : allowedActions(p).filter(canDo)
            return (
              <li
                key={p.id}
                aria-label={label(p)}
                className={cn(
                  'flex flex-col gap-2 rounded-md border border-border bg-surface p-3',
                  isCurrent && 'border-primary ring-1 ring-primary/30',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{label(p)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(p.start_date, locale)} – {formatDate(p.end_date, locale)}
                    </p>
                  </div>
                  <PeriodStatusBadge status={p.status} />
                </div>
                {isCurrent && <p className="text-xs text-primary">{t('periods.current')}</p>}
                {drafts > 0 && (
                  <p className="flex items-center gap-1 text-xs text-warning-soft-foreground">
                    <FileWarning className="size-3.5" aria-hidden="true" />
                    {t('periods.drafts', { count: drafts })}
                  </p>
                )}
                {actions.length > 0 && (
                  <div className="mt-auto flex flex-wrap gap-1 pt-1">
                    {actions.map((action) => {
                      const Icon = ICON[action]
                      return (
                        <Button
                          key={action}
                          size="sm"
                          variant={action === 'reopen' ? 'ghost' : 'secondary'}
                          aria-label={t(`periods.actions.${ACTION_KEY[action]}Named`, {
                            period: label(p),
                          })}
                          onClick={() => setDialog({ period: p, action })}
                        >
                          <Icon aria-hidden="true" />
                          {t(`periods.actions.${ACTION_KEY[action]}`)}
                        </Button>
                      )
                    })}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {periods.data && sorted.length === 0 && (
        <p role="status" className="py-6 text-center text-sm text-muted-foreground">
          {t('periods.none')}
        </p>
      )}
      {dialog && (
        <PeriodActionDialog
          period={dialog.period}
          action={dialog.action}
          label={label(dialog.period)}
          onClose={() => setDialog(null)}
        />
      )}
    </AccountingShell>
  )
}
