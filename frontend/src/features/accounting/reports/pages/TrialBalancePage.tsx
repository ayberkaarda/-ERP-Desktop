import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ChevronRight, Play, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { FieldShell } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { cn } from '@/lib/utils'
import { journalKeys } from '../../journal/api/keys'
import { ExportButtons } from '../../journal/components/ExportButtons'
import { LoadError } from '../../journal/components/LoadError'
import { PresetsMenu } from '../../journal/components/PresetsMenu'
import { useCompany } from '../../journal/hooks/queries'
import { amountOf } from '../../journal/lib/balance'
import { selectClass } from '../../journal/lib/ui'
import { REPORT_PATHS, reportsApi } from '../api'
import { RangeFields } from '../components/RangeFields'
import { hasRange, rangeParams, type ParamRecord } from '../lib/params'
import { buildTrialTree, checkTotals, visibleTrialRows } from '../lib/trialTree'
import { useReportParams } from '../lib/useReportParams'
import type { TrialBalanceAmounts } from '../types'

const KEYS = [
  'mode',
  'period_id',
  'date_from',
  'date_to',
  'level',
  'include_zero',
  'compare',
] as const
const DEFAULTS: ParamRecord = { mode: 'range', level: '3', include_zero: '0', compare: '0' }
const LEVELS = ['1', '2', '3', '4', '5'] as const

function apiParams(p: ParamRecord): Record<string, string> {
  return {
    ...rangeParams(p),
    level: p.level ?? '3',
    include_zero: p.include_zero === '1' ? '1' : '0',
    compare_with_previous_year: p.compare === '1' ? '1' : '0',
  }
}

/** Mizan: period or range, level, zero rows, previous-year comparison, debit = credit check. */
export function TrialBalancePage() {
  const { t } = useTranslation('accountingJournal')
  const locale = useIntlLocale()
  useCompany()
  const { applied, apply, ready } = useReportParams(KEYS, DEFAULTS)
  const [draft, setDraft] = useState<ParamRecord>(applied)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const params = apiParams(applied)
  const enabled = ready && hasRange(applied)
  const report = useQuery({
    queryKey: journalKeys.report('trial-balance', params),
    queryFn: ({ signal }) => reportsApi.trialBalance(params, signal),
    enabled,
  })
  const tree = useMemo(() => buildTrialTree(report.data?.rows ?? []), [report.data])
  const rows = visibleTrialRows(tree, collapsed)
  const compare = applied.compare === '1'
  const money = (v: string | undefined | null) =>
    v && !amountOf(v).isZero() ? formatDecimalDisplay(v, { locale }) : ''

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    if (!hasRange(draft)) return
    setCollapsed(new Set())
    apply(draft)
  }

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const check = report.data ? checkTotals(report.data.totals) : null
  const ok = check
    ? check.movementsBalanced && check.balancesBalanced && report.data?.balanced !== false
    : false

  const amountCells = (a: Partial<TrialBalanceAmounts>, strong = false) =>
    (
      [
        'opening_debit',
        'opening_credit',
        'debit',
        'credit',
        'balance_debit',
        'balance_credit',
      ] as const
    ).map((k) => (
      <td key={k} className={cn('px-2 py-1 text-right tabular-nums', strong && 'font-semibold')}>
        {money(a[k])}
      </td>
    ))

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6">
      <PageHeader
        title={t('trialBalance.title')}
        description={t('trialBalance.description')}
        breadcrumbs={[
          { label: t('nav.accounting') },
          { label: t('nav.reports') },
          { label: t('trialBalance.title') },
        ]}
        actions={
          <>
            <PresetsMenu
              storageKey="accounting.reports.trial-balance"
              allowed={KEYS}
              title={t('presets.params')}
              current={draft}
              onApply={(p) => {
                const next = { ...DEFAULTS, ...p }
                setDraft(next)
                if (hasRange(next)) apply(next)
              }}
            />
            <ExportButtons
              path={REPORT_PATHS.trialBalance}
              params={params}
              filename="mizan"
              disabled={!enabled}
            />
          </>
        }
      />
      <form
        onSubmit={submit}
        aria-label={t('reports.parameters')}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3 print:hidden"
      >
        <RangeFields value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
        <FieldShell label={t('trialBalance.level')} className="w-32">
          {(control) => (
            <select
              {...control}
              className={selectClass}
              value={draft.level ?? '3'}
              onChange={(e) => setDraft((d) => ({ ...d, level: e.target.value }))}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t('trialBalance.levelOption', { level: l })}
                </option>
              ))}
            </select>
          )}
        </FieldShell>
        <label className="flex h-control items-center gap-2 text-sm">
          <Checkbox
            checked={draft.include_zero === '1'}
            onChange={(e) =>
              setDraft((d) => ({ ...d, include_zero: e.target.checked ? '1' : '0' }))
            }
          />
          {t('trialBalance.includeZero')}
        </label>
        <label className="flex h-control items-center gap-2 text-sm">
          <Checkbox
            checked={draft.compare === '1'}
            onChange={(e) => setDraft((d) => ({ ...d, compare: e.target.checked ? '1' : '0' }))}
          />
          {t('trialBalance.compare')}
        </label>
        <Button type="submit" disabled={!hasRange(draft)}>
          <Play aria-hidden="true" />
          {t('reports.run')}
        </Button>
      </form>

      {!enabled ? (
        <EmptyState description={t('reports.choose')} />
      ) : report.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : report.isError ? (
        <LoadError error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {ok ? (
              <Badge tone="success" role="status">
                <CheckCircle2 aria-hidden="true" />
                {t('trialBalance.balanced')}
              </Badge>
            ) : (
              <Badge tone="danger" role="status">
                <TriangleAlert aria-hidden="true" />
                {t('trialBalance.unbalanced', {
                  movement: formatDecimalDisplay(check?.movementDifference ?? '0', { locale }),
                  balance: formatDecimalDisplay(check?.balanceDifference ?? '0', { locale }),
                })}
              </Badge>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setCollapsed(new Set())}>
              {t('trialBalance.expandAll')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setCollapsed(
                  new Set(tree.filter((n) => n.hasChildren).map((n) => n.row.account_id)),
                )
              }
            >
              {t('trialBalance.collapseAll')}
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-table" aria-label={t('trialBalance.title')}>
              <thead className="bg-surface-sunken text-xs text-muted-foreground">
                <tr>
                  <th scope="col" rowSpan={2} className="px-2 py-1 text-left font-medium">
                    {t('trialBalance.account')}
                  </th>
                  <th scope="colgroup" colSpan={2} className="px-2 py-1 text-center font-medium">
                    {t('trialBalance.opening')}
                  </th>
                  <th scope="colgroup" colSpan={2} className="px-2 py-1 text-center font-medium">
                    {t('trialBalance.movements')}
                  </th>
                  <th scope="colgroup" colSpan={2} className="px-2 py-1 text-center font-medium">
                    {t('trialBalance.balance')}
                  </th>
                  {compare && (
                    <th scope="colgroup" colSpan={2} className="px-2 py-1 text-center font-medium">
                      {t('trialBalance.previousBalance')}
                    </th>
                  )}
                </tr>
                <tr>
                  {Array.from({ length: compare ? 4 : 3 }, (_, i) => i).flatMap((i) => [
                    <th key={`d${i}`} scope="col" className="px-2 py-1 text-right font-medium">
                      {t('trialBalance.debit')}
                    </th>,
                    <th key={`c${i}`} scope="col" className="px-2 py-1 text-right font-medium">
                      {t('trialBalance.credit')}
                    </th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={compare ? 9 : 7}
                      className="px-3 py-6 text-center text-sm text-muted-foreground"
                    >
                      {t('reports.noRows')}
                    </td>
                  </tr>
                )}
                {rows.map(({ row, depth, hasChildren }) => {
                  const open = !collapsed.has(row.account_id)
                  return (
                    <tr
                      key={row.account_id}
                      className={cn('border-t border-border', depth === 0 && 'font-medium')}
                      aria-level={depth + 1}
                    >
                      <th scope="row" className="px-2 py-1 text-left font-normal">
                        <span
                          className="flex items-center gap-1"
                          style={{ paddingLeft: `${depth * 1.25}rem` }}
                        >
                          {hasChildren ? (
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-label={t(
                                open ? 'trialBalance.collapse' : 'trialBalance.expand',
                                {
                                  code: row.code,
                                },
                              )}
                              className="rounded-xs p-0.5 text-muted-foreground hover:text-foreground print:hidden"
                              onClick={() => toggle(row.account_id)}
                            >
                              {open ? (
                                <ChevronDown className="size-4" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="size-4" aria-hidden="true" />
                              )}
                            </button>
                          ) : (
                            <span className="inline-block w-5" aria-hidden="true" />
                          )}
                          <Link
                            to={`/accounting/reports/general-ledger?account_id=${encodeURIComponent(row.account_id)}&date_from=${report.data.date_from}&date_to=${report.data.date_to}`}
                            className="font-code hover:underline"
                          >
                            {row.code}
                          </Link>
                          <span className="truncate">{row.name}</span>
                        </span>
                      </th>
                      {amountCells(row)}
                      {compare && (
                        <>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                            {money(row.previous?.balance_debit)}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                            {money(row.previous?.balance_credit)}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t-2 border-border-strong bg-surface-sunken">
                <tr>
                  <th scope="row" className="px-2 py-2 text-left">
                    {t('trialBalance.totals')}
                  </th>
                  {amountCells(report.data.totals, true)}
                  {compare && (
                    <>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">
                        {money(report.data.previous_totals?.balance_debit)}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">
                        {money(report.data.previous_totals?.balance_credit)}
                      </td>
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
