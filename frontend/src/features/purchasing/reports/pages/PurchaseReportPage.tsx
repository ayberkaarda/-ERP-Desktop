import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMatches } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { NotFound } from '@/components/shared/NotFound'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ExportButtons } from '@/features/sales/invoices/kit/components/ExportButtons'
import { LoadError } from '@/features/sales/invoices/kit/components/LoadError'
import { PresetsMenu } from '@/features/sales/invoices/kit/components/PresetsMenu'
import type { Pagination } from '@/features/sales/invoices/kit/types'
import { ReportChart } from '@/features/sales/reports/components/ReportChart'
import { useRowLabels } from '@/features/sales/reports/lib/labels'
import type { ColLabel as SalesColLabel } from '@/features/sales/reports/definitions'
import { useCompanyStore } from '@/stores/company'
import { http } from '../../invoices/kit/http'
import { purchKeys } from '../../invoices/kit/keys'
import { REPORTS_BASE } from '../../invoices/kit/links'
import { ReportParamsForm } from '../components/ReportParamsForm'
import { ReportTable } from '../components/ReportTable'
import { AGEING_BUCKETS, reportBySlug, viewFor, type ReportDef, type Row } from '../definitions'
import {
  apiParams,
  initialParams,
  missingRequired,
  paramKeys,
  rangeInvalid,
  totalsRow,
  useReportParams,
  type ParamRecord,
} from '../lib/params'
import { chartRows, metaTotals } from '../lib/values'

/** Rows per page asked from the API. */
export const REPORT_PAGE_SIZE = 100

interface ReportResponse {
  data: Row[]
  meta?: Row & { pagination?: Pagination }
}

/** Legend keys of the shared chart (its stacked legend reads the Sales column labels). */
const CHART_LABELS: Record<string, SalesColLabel> = {
  not_due: 'notDue',
  days_0_30: 'days0to30',
  days_31_60: 'days31to60',
  days_61_90: 'days61to90',
  days_over_90: 'daysOver90',
}

function useReportDef(): ReportDef | undefined {
  const matches = useMatches()
  const handle = matches.at(-1)?.handle as { report?: string } | undefined
  return reportBySlug(handle?.report)
}

export function PurchaseReportPage() {
  const def = useReportDef()
  if (!def) return <NotFound />
  return <ReportView key={def.slug} def={def} />
}

/** Parameters (URL + saved sets), chart, table, totals and CSV/XLSX export of one report. */
function ReportView({ def }: { def: ReportDef }) {
  const { t } = useTranslation('purchasing-reports')
  useCompanyStore((s) => s.activeCompanyId)
  const keys = paramKeys(def)
  const { applied, apply, ready } = useReportParams(keys)
  const [draft, setDraft] = useState<ParamRecord>(() =>
    ready ? { ...initialParams(def), ...applied } : initialParams(def),
  )
  const [page, setPage] = useState(1)
  const params = apiParams(def, applied)
  const paramsKey = JSON.stringify(params)
  const [seen, setSeen] = useState(paramsKey)
  if (seen !== paramsKey) {
    setSeen(paramsKey)
    setPage(1)
  }
  const query = { ...params, page: String(page), per_page: String(REPORT_PAGE_SIZE) }
  const view = viewFor(def, params.group_by)
  const enabled = ready && missingRequired(def, applied).length === 0 && !rangeInvalid(applied)
  const report = useQuery({
    queryKey: purchKeys.report(def.slug, query),
    queryFn: ({ signal }) => http().get<ReportResponse>(def.path, { params: query, signal }),
    enabled,
    placeholderData: keepPreviousData,
  })
  const title = t(`report.${def.id}.title`)
  // category_id resolved to a label (by-item, return-rate category/item views).
  const rows = useRowLabels(report.data?.data)
  const meta: Row = report.data?.meta ?? {}
  const pagination = report.data?.meta?.pagination
  const lastPage = pagination?.last_page ?? 1
  const totals = totalsRow(view.columns, meta)
  const isAgeing = view.chart?.kind === 'stacked'

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 px-6 py-6">
      <PageHeader
        title={title}
        description={t(`report.${def.id}.description`)}
        breadcrumbs={[
          { label: t('hub.purchasing') },
          { label: t('hub.title'), to: REPORTS_BASE },
          { label: title },
        ]}
        actions={
          <>
            <PresetsMenu
              storageKey={`purchasing.reports.${def.slug}`}
              allowed={keys}
              title={t('hub.presets')}
              current={draft}
              onApply={(p) => {
                const next = { ...initialParams(def), ...p }
                setDraft(next)
                if (missingRequired(def, next).length === 0 && !rangeInvalid(next)) apply(next)
              }}
            />
            <ExportButtons
              path={def.path}
              params={params}
              filename={def.slug}
              disabled={!enabled}
            />
          </>
        }
      />
      <ReportParamsForm def={def} value={draft} onChange={setDraft} onSubmit={() => apply(draft)} />
      {!enabled ? (
        <EmptyState description={t('hub.choose')} />
      ) : report.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : report.isError ? (
        <LoadError error={report.error} onRetry={() => void report.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState description={t('hub.empty')} />
      ) : (
        <>
          {view.chart && (
            <ReportChart
              def={view.chart}
              rows={chartRows(view.chart, rows)}
              totals={isAgeing ? metaTotals(meta) : totals}
              title={t(`report.${def.id}.chart`)}
              labels={
                isAgeing
                  ? Object.fromEntries(AGEING_BUCKETS.map((b) => [b, CHART_LABELS[b] ?? 'total']))
                  : {}
              }
            />
          )}
          <ReportTable def={def} columns={view.columns} rows={rows} totals={totals} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t('hub.rows', { count: pagination?.total ?? rows.length })}</span>
            {lastPage > 1 && (
              <span className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1 || report.isFetching}
                  aria-label={t('hub.prevPage')}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <span className="tabular-nums" data-testid="report-page">
                  {t('hub.page', { page, pages: lastPage })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={page >= lastPage || report.isFetching}
                  aria-label={t('hub.nextPage')}
                  onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
