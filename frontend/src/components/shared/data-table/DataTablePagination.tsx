import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useIntlLocale } from '@/lib/datetime'
import { pageCount, PER_PAGE_OPTIONS, updateListQuery, type ListQueryState } from './listQuery'

interface DataTablePaginationProps {
  query: ListQueryState
  total: number
  onQueryChange: (next: ListQueryState) => void
  onPerPageChange?: (perPage: number) => void
}

export function DataTablePagination({
  query,
  total,
  onQueryChange,
  onPerPageChange,
}: DataTablePaginationProps) {
  const { t } = useTranslation('common')
  const locale = useIntlLocale()
  const perPageId = useId()
  const pages = pageCount(total, query.perPage)
  const page = Math.min(Math.max(query.page, 1), pages)
  const from = total === 0 ? 0 : (page - 1) * query.perPage + 1
  const to = Math.min(page * query.perPage, total)
  const n = new Intl.NumberFormat(locale)
  const go = (p: number) => onQueryChange(updateListQuery(query, { page: p }))

  return (
    <nav
      aria-label={t('dataTable.pagination')}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-3 py-2 text-xs text-muted-foreground"
    >
      <p aria-live="polite">
        {t('dataTable.range', { from: n.format(from), to: n.format(to), total: n.format(total) })}
      </p>
      <div className="flex items-center gap-2">
        <span id={perPageId}>{t('dataTable.perPage')}</span>
        <Select
          value={String(query.perPage)}
          onValueChange={(v) => {
            const perPage = Number(v)
            onPerPageChange?.(perPage)
            onQueryChange(updateListQuery(query, { perPage }))
          }}
        >
          <SelectTrigger aria-labelledby={perPageId} className="h-control-sm w-18 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PER_PAGE_OPTIONS.map((o) => (
              <SelectItem key={o} value={String(o)}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <span className="mr-2">
          {t('dataTable.page', { page: n.format(page), pages: n.format(pages) })}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('dataTable.firstPage')}
          disabled={page <= 1}
          onClick={() => go(1)}
        >
          <ChevronsLeft aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('dataTable.prevPage')}
          disabled={page <= 1}
          onClick={() => go(page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('dataTable.nextPage')}
          disabled={page >= pages}
          onClick={() => go(page + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('dataTable.lastPage')}
          disabled={page >= pages}
          onClick={() => go(pages)}
        >
          <ChevronsRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}
