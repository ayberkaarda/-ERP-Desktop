import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMatches } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { NotFound } from '@/components/shared/NotFound'
import { PageHeader } from '@/components/shared/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { reportsApi } from '../../documents/api/client'
import { invDocsKeys } from '../../documents/api/keys'
import { ExportButtons } from '../../documents/components/ExportButtons'
import { LoadError } from '../../documents/components/LoadError'
import { PresetsMenu } from '../../documents/components/PresetsMenu'
import { useCompany } from '../../documents/hooks/queries'
import { ReportParamsForm } from '../components/ReportParamsForm'
import { ReportTable } from '../components/ReportTable'
import { REPORTS_BASE, reportBySlug, type ReportData, type ReportDef } from '../definitions'
import {
  apiParams,
  initialParams,
  missingRequired,
  paramKeys,
  useReportParams,
  type ParamRecord,
} from '../lib/params'

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

/** Parameters (URL + saved sets), run, table and CSV/XLSX export of one report. */
function ReportView({ def }: { def: ReportDef }) {
  const { t } = useTranslation('inventoryDocs')
  useCompany()
  const keys = paramKeys(def)
  const { applied, apply, ready } = useReportParams(keys)
  const [draft, setDraft] = useState<ParamRecord>(() =>
    ready ? { ...initialParams(def), ...applied } : initialParams(def),
  )
  const params = apiParams(def, applied)
  const enabled = ready && missingRequired(def, applied).length === 0
  const report = useQuery({
    queryKey: invDocsKeys.report(def.slug, params),
    queryFn: ({ signal }) => reportsApi.get<ReportData>(def.path, params, signal),
    enabled,
  })
  const title = t(`report.${def.id}.title`)

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
        <EmptyState description={t('reports.choose')} />
      ) : report.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : report.isError ? (
        <LoadError error={report.error} onRetry={() => void report.refetch()} />
      ) : (report.data.rows ?? []).length === 0 && !report.data.opening ? (
        <EmptyState description={t('reports.empty')} />
      ) : (
        <ReportTable def={def} data={report.data} />
      )}
    </div>
  )
}
