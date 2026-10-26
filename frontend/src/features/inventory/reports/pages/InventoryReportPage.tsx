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
import { reportsApi } from '../../documents/api/client'
import { invDocsKeys } from '../../documents/api/keys'
import { ExportButtons } from '../../documents/components/ExportButtons'
import { LoadError } from '../../documents/components/LoadError'
import { PresetsMenu } from '../../documents/components/PresetsMenu'
import { useCompany } from '../../documents/hooks/queries'
import { ReportParamsForm } from '../components/ReportParamsForm'
import { ReportTable } from '../components/ReportTable'
import {
  REPORTS_BASE,
  reportBySlug,
  visibleColumns,
  type ReportDef,
  type Row,
} from '../definitions'
import {
  apiParams,
  initialParams,
  missingRequired,
  paramKeys,
  useReportParams,
  type ParamRecord,
} from '../lib/params'

/** Rows per page asked from the API (it allows up to 500). */
export const REPORT_PAGE_SIZE = 100

/** The report of the matched route (`handle.report` holds its slug). */
function useReportDef(): ReportDef | undefined {
  const matches = useMatches()
  const handle = matches.at(-1)?.handle as { report?: string } | undefined
  return reportBySlug(handle?.report)
}

export function InventoryReportPage() {
  const def = useReportDef()
  if (!def) return <NotFound />
  return <ReportView key={def.slug} def={def} />
}

/** Parameters (URL + saved sets), run, paged table and CSV/XLSX export of one report. */
function ReportView({ def }: { def: ReportDef }) {
  const { t } = useTranslation('inventoryDocs')
  useCompany()
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
    // New parameters start on the first page.
    setSeen(paramsKey)
    setPage(1)
  }
  const query = def.paged
    ? { ...params, page: String(page), per_page: String(REPORT_PAGE_SIZE) }
    : params
  const enabled = ready && missingRequired(def, applied).length === 0
  const report = useQuery({
    queryKey: invDocsKeys.report(def.slug, query),
    queryFn: ({ signal }) => reportsApi.get(def.path, query, signal),
    enabled,
    placeholderData: keepPreviousData,
  })
  const title = t(`report.${def.id}.title`)
  const columns = visibleColumns(def, params.group_by)
  const meta: Row = report.data?.meta ?? {}
  const pagination = report.data?.meta?.pagination
  const rows = report.data?.data ?? []
  const lastPage = pagination?.last_page ?? 1
  const note = basisNote(meta)

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-6">
      <PageHeader
        title={title}
        description={t(`report.${def.id}.description`)}
        breadcrumbs={[
          { label: t('nav.inventory') },
          { label: t('reports.hubTitle'), to: REPORTS_BASE },
          { label: title },
        ]}
        actions={
          <>
            <PresetsMenu
              storageKey={`inventory.reports.${def.slug}`}
              allowed={keys}
              title={t('presets.params')}
              current={draft}
              onApply={(p) => {
                const next = { ...initialParams(def), ...p }
                setDraft(next)
                if (missingRequired(def, next).length === 0) apply(next)
              }}
            />
            {def.exportable && (
              <ExportButtons
                path={def.path}
                params={params}
                filename={def.slug}
                disabled={!enabled}
              />
            )}
          </>
        }
      />
      <ReportParamsForm def={def} value={draft} onChange={setDraft} onSubmit={() => apply(draft)} />
      {!enabled ? (
        <EmptyState description={t('reports.choose')} />
      ) : report.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : report.isError ? (
        <LoadError error={report.error} onRetry={() => void report.refetch()} />
      ) : rows.length === 0 && !(def.ledger && meta.opening) ? (
        <EmptyState description={t('reports.empty')} />
      ) : (
        <div className="space-y-2">
          {note && (
            <p role="note" className="text-xs text-muted-foreground" data-testid="report-basis">
              {t(`reports.${note.key}`, {
                method:
                  note.method === 'fifo'
                    ? t('param.methodFifo')
                    : note.method === 'moving_average'
                      ? t('param.methodMovingAverage')
                      : note.method,
              })}
            </p>
          )}
          <ReportTable
            def={def}
            columns={columns}
            rows={rows}
            meta={meta}
            firstPage={page === 1}
            lastPage={page >= lastPage}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t('reports.rows', { count: pagination?.total ?? rows.length })}</span>
            {lastPage > 1 && (
              <span className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1 || report.isFetching}
                  aria-label={t('count.prevPage')}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <span className="tabular-nums" data-testid="report-page">
                  {t('count.page', { page, pages: lastPage })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={page >= lastPage || report.isFetching}
                  aria-label={t('count.nextPage')}
                  onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

type BasisKey = 'basisBooked' | 'basisSimulated' | 'basisLayers' | 'basisReceipts'

/** Valuation (booked or a simulated method) and ageing (FIFO layers or receipts) say how. */
function basisNote(meta: Row): { key: BasisKey; method: string } | null {
  const method = typeof meta.method === 'string' ? meta.method : ''
  switch (meta.basis) {
    case 'booked':
      return { key: 'basisBooked', method }
    case 'simulated':
      return { key: 'basisSimulated', method }
    case 'layers':
      return { key: 'basisLayers', method }
    case 'receipts':
      return { key: 'basisReceipts', method }
    default:
      return null
  }
}
