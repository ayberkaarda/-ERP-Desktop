import { CalendarPlus, CalendarRange, Lock, LockOpen, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatDateTime, useIntlLocale } from '@/lib/datetime'
import { Can, usePermission } from '@/lib/permissions'
import { AccountingShell, LoadError, NativeSelect } from '../../shared/components'
import { useAccT } from '../../shared/i18n'
import { PeriodStatusBadge } from '../../shared/PeriodStatusBadge'
import { ACC_PERMISSIONS } from '../../shared/permissions'
import { useFiscalYears } from '../../shared/queries'
import { SavedViewsMenu } from '../../shared/SavedViewsMenu'
import type { FiscalYear } from '../../shared/types'
import { FiscalYearWizard } from '../components/FiscalYearWizard'
import { YearEditDialog } from '../components/YearEditDialog'
import { YearTransitionDialog } from '../components/YearTransitionDialog'

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; year: FiscalYear }
  | { kind: 'close' | 'reopen'; year: FiscalYear }
  | null

const VIEW_KEY = 'accounting.fiscal-years'

export function FiscalYearsPage() {
  const t = useAccT()
  const locale = useIntlLocale()
  const [params, setParams] = useSearchParams()
  const years = useFiscalYears()
  const canManage = usePermission(ACC_PERMISSIONS.periods.manage)
  const canClose = usePermission(ACC_PERMISSIONS.year.close)
  const [dialog, setDialog] = useState<Dialog>(() =>
    params.get('new') === '1' ? { kind: 'create' } : null,
  )
  const status = params.get('status') ?? ''
  const rows = (years.data ?? []).filter((y) => !status || y.status === status)

  const setStatus = (value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set('status', value)
        else next.delete('status')
        return next
      },
      { replace: true },
    )

  const closeDialog = () => {
    setDialog(null)
    if (params.get('new')) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('new')
          return next
        },
        { replace: true },
      )
    }
  }

  return (
    <AccountingShell
      title={t('fiscal.title')}
      description={t('fiscal.subtitle')}
      actions={
        <>
          <SavedViewsMenu
            storageKey={VIEW_KEY}
            current={status ? { status } : {}}
            onApply={(v) => setStatus(v.status ?? '')}
          />
          <Can permission={ACC_PERMISSIONS.periods.manage}>
            <Button onClick={() => setDialog({ kind: 'create' })}>
              <CalendarPlus aria-hidden="true" />
              {t('fiscal.new')}
            </Button>
          </Can>
        </>
      }
    >
      <div className="mb-3 flex items-end gap-3">
        <FieldShell label={t('fiscal.fields.status')} className="w-44">
          {(control) => (
            <NativeSelect
              {...control}
              value={status}
              emptyLabel={t('common.all')}
              options={[
                { value: 'open', label: t('periods.status.open') },
                { value: 'closed', label: t('periods.status.closed') },
              ]}
              onChange={(e) => setStatus(e.target.value)}
            />
          )}
        </FieldShell>
      </div>
      {years.isLoading && <Skeleton className="h-40 w-full" aria-label={t('common.loading')} />}
      {years.isError && <LoadError error={years.error} onRetry={() => void years.refetch()} />}
      {years.data?.length === 0 && (
        <EmptyState
          icon={<CalendarRange className="size-10 text-muted-foreground" aria-hidden="true" />}
          title={t('fiscal.empty')}
          description={t('fiscal.emptyBody')}
        />
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className="w-full text-table">
            <caption className="sr-only">{t('fiscal.title')}</caption>
            <thead className="bg-surface-sunken text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">
                  {t('fiscal.fields.code')}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t('fiscal.fields.name')}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t('fiscal.fields.range')}
                </th>
                <th scope="col" className="px-3 py-2">
                  {t('fiscal.fields.status')}
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  {t('common.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((y) => (
                <tr key={y.id} className="border-t border-border">
                  <td className="px-3 py-2 font-code">{y.code}</td>
                  <td className="px-3 py-2">{y.name}</td>
                  <td className="px-3 py-2">
                    {formatDate(y.start_date, locale)} – {formatDate(y.end_date, locale)}
                  </td>
                  <td className="px-3 py-2">
                    <PeriodStatusBadge status={y.status} />
                    {y.closed_at && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {formatDateTime(y.closed_at, locale)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/accounting/periods?year=${encodeURIComponent(y.id)}`}>
                          {t('fiscal.periodsLink')}
                        </Link>
                      </Button>
                      {canManage && y.status === 'open' && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('fiscal.editNamed', { code: y.code })}
                          onClick={() => setDialog({ kind: 'edit', year: y })}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                      )}
                      {canClose && y.status === 'open' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDialog({ kind: 'close', year: y })}
                        >
                          <Lock aria-hidden="true" />
                          {t('fiscal.close.action')}
                        </Button>
                      )}
                      {canClose && y.status === 'closed' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDialog({ kind: 'reopen', year: y })}
                        >
                          <LockOpen aria-hidden="true" />
                          {t('fiscal.reopen.action')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog?.kind === 'create' && canManage && years.data && (
        <FiscalYearWizard years={years.data} onClose={closeDialog} />
      )}
      {dialog?.kind === 'edit' && <YearEditDialog year={dialog.year} onClose={closeDialog} />}
      {(dialog?.kind === 'close' || dialog?.kind === 'reopen') && (
        <YearTransitionDialog year={dialog.year} action={dialog.kind} onClose={closeDialog} />
      )}
    </AccountingShell>
  )
}
