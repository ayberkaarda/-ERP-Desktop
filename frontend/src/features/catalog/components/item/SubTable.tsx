import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface SubTableProps {
  label: string
  headers: string[]
  rows: { id: string; cells: ReactNode[]; actions?: ReactNode }[]
  query: { isPending: boolean; isError: boolean; refetch: () => unknown }
  empty: string
}

/** Small read table for an item's sub-records (they are few; no paging needed). */
export function SubTable({ label, headers, rows, query, empty }: SubTableProps) {
  const { t } = useTranslation('catalog')
  if (query.isPending) return <Skeleton className="h-24 w-full" />
  if (query.isError) {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-danger">
        {t('errors.loadFailed')}
        <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
          {t('actions.retry')}
        </Button>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full border-separate border-spacing-0 text-table" aria-label={label}>
        <thead className="bg-surface-sunken text-xs text-muted-foreground">
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                scope="col"
                className="h-row border-b border-border px-3 text-left font-medium"
              >
                {h}
              </th>
            ))}
            <th scope="col" className="h-row w-24 border-b border-border px-3">
              <span className="sr-only">{t('common.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={headers.length + 1}
                className="px-3 py-6 text-center text-sm text-muted-foreground"
              >
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              {r.cells.map((c, i) => (
                <td key={i} className="h-row border-b border-border px-3">
                  {c}
                </td>
              ))}
              <td className="h-row border-b border-border px-2 text-right whitespace-nowrap">
                {r.actions}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
