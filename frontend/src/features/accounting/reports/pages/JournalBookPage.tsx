import { useQuery } from '@tanstack/react-query'
import { Play, Printer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { FieldShell } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { ApiError, isApiError } from '@/platform'
import { journalKeys } from '../../journal/api/keys'
import { ExportButtons } from '../../journal/components/ExportButtons'
import { LoadError } from '../../journal/components/LoadError'
import { PresetsMenu } from '../../journal/components/PresetsMenu'
import { useCompany } from '../../journal/hooks/queries'
import { amountOf } from '../../journal/lib/balance'
import { selectClass } from '../../journal/lib/ui'
import { BOOK_CHANGED, BOOK_TOO_LARGE, REPORT_PATHS, reportsApi } from '../api'
import { RangeFields } from '../components/RangeFields'
import {
  BOOK_PAGE_SIZES,
  paginateBook,
  parseBookPageSize,
  type BookTotals,
} from '../lib/journalBook'
import '../print.css'
import { hasRange, rangeParams, type ParamRecord } from '../lib/params'
import { useReportParams } from '../lib/useReportParams'

const KEYS = ['mode', 'period_id', 'date_from', 'date_to', 'page_size'] as const
const DEFAULTS: ParamRecord = { mode: 'range', page_size: '30' }

/** Yevmiye defteri: entries by number, printed pages with devreden / nakledilen totals. */
export function JournalBookPage() {
  const { t } = useTranslation('accountingJournal')
  const locale = useIntlLocale()
  useCompany()
  const { applied, apply, ready } = useReportParams(KEYS, DEFAULTS)
  const [draft, setDraft] = useState<ParamRecord>(applied)
  const params = rangeParams(applied)
  const enabled = ready && hasRange(applied)
  const pageSize = parseBookPageSize(applied.page_size)
  // A valid custom size from a link or preset stays selectable.
  const sizeOptions = [
    ...new Set<number>([...BOOK_PAGE_SIZES, pageSize, parseBookPageSize(draft.page_size)]),
  ].sort((x, y) => x - y)
  // Print styles (print.css) apply only while the book is on screen.
  useEffect(() => {
    document.documentElement.setAttribute('data-print-book', '')
    return () => document.documentElement.removeAttribute('data-print-book')
  }, [])
  const book = useQuery({
    queryKey: journalKeys.report('journal-book', params),
    queryFn: ({ signal }) => reportsApi.journalBook(params, signal),
    enabled,
  })
  const pages = useMemo(
    () => (book.data ? paginateBook(book.data.entries, pageSize, book.data.carriedForward) : []),
    [book.data, pageSize],
  )
  const money = (v: string) => (amountOf(v).isZero() ? '' : formatDecimalDisplay(v, { locale }))
  const total = (v: string) => formatDecimalDisplay(v, { locale })

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    if (hasRange(draft)) apply(draft)
  }

  const totalsRow = (label: string, totals: BookTotals, testId: string) => (
    <tr className="bg-surface-sunken font-semibold" data-testid={testId}>
      <th scope="row" colSpan={4} className="px-2 py-1 text-right">
        {label}
      </th>
      <td className="px-2 py-1 text-right tabular-nums">{total(totals.debit)}</td>
      <td className="px-2 py-1 text-right tabular-nums">{total(totals.credit)}</td>
    </tr>
  )

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6 print:max-w-none print:p-0">
      <div className="print:hidden">
        <PageHeader
          title={t('book.title')}
          description={t('book.description')}
          breadcrumbs={[
            { label: t('nav.accounting') },
            { label: t('nav.reports') },
            { label: t('book.title') },
          ]}
          actions={
            <>
              <PresetsMenu
                storageKey="accounting.reports.journal-book"
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
                path={REPORT_PATHS.journalBook}
                params={params}
                filename="yevmiye-defteri"
                disabled={!enabled}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pages.length === 0}
                onClick={() => window.print()}
              >
                <Printer aria-hidden="true" />
                {t('book.print')}
              </Button>
            </>
          }
        />
        <form
          onSubmit={submit}
          aria-label={t('reports.parameters')}
          className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
        >
          <RangeFields value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
          <FieldShell label={t('book.pageSize')} className="w-40">
            {(control) => (
              <select
                {...control}
                className={selectClass}
                value={String(parseBookPageSize(draft.page_size))}
                onChange={(e) => {
                  const page_size = e.target.value
                  setDraft((d) => ({ ...d, page_size }))
                  // Page size only changes the layout: apply it at once when a book is shown.
                  if (enabled) apply({ ...applied, page_size })
                }}
              >
                {sizeOptions.map((n) => (
                  <option key={n} value={String(n)}>
                    {t('book.pageSizeOption', { count: n })}
                  </option>
                ))}
              </select>
            )}
          </FieldShell>
          <Button type="submit" disabled={!hasRange(draft)}>
            <Play aria-hidden="true" />
            {t('reports.run')}
          </Button>
        </form>
      </div>

      {!enabled ? (
        <EmptyState description={t('reports.choose')} />
      ) : book.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : book.isError ? (
        isApiError(book.error) && book.error.code === BOOK_TOO_LARGE ? (
          <p
            role="alert"
            className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm"
          >
            {t('book.tooLarge')}
          </p>
        ) : (
          <LoadError
            error={
              isApiError(book.error) && book.error.code === BOOK_CHANGED
                ? new ApiError(0, BOOK_CHANGED, t('book.changed'))
                : book.error
            }
            onRetry={() => void book.refetch()}
          />
        )
      ) : book.data.entries.length === 0 ? (
        <EmptyState description={t('book.empty')} />
      ) : (
        <div id="journal-book-print" className="space-y-6 print:space-y-0">
          {pages.map((page) => (
            <section
              key={page.number}
              aria-label={t('book.page', { number: page.number, total: pages.length })}
              className="journal-book-page break-after-page rounded-lg border border-border bg-surface p-4 print:rounded-none print:border-0 print:p-0"
            >
              <div className="mb-2 flex items-baseline justify-between text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{t('book.title')}</span>
                <span>
                  {formatDate(book.data.range.date_from, locale)} –{' '}
                  {formatDate(book.data.range.date_to, locale)}
                </span>
                <span>{t('book.page', { number: page.number, total: pages.length })}</span>
              </div>
              <table className="w-full text-table">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="w-28 px-2 py-1 text-left font-medium">
                      {t('fields.entryDate')}
                    </th>
                    <th scope="col" className="w-32 px-2 py-1 text-left font-medium">
                      {t('book.accountCode')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-left font-medium">
                      {t('book.accountName')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-left font-medium">
                      {t('fields.description')}
                    </th>
                    <th scope="col" className="w-32 px-2 py-1 text-right font-medium">
                      {t('lines.debit')}
                    </th>
                    <th scope="col" className="w-32 px-2 py-1 text-right font-medium">
                      {t('lines.credit')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {totalsRow(
                    t('book.broughtForward'),
                    page.broughtForward,
                    `brought-${page.number}`,
                  )}
                  {page.rows.map((row) =>
                    row.kind === 'entry' ? (
                      <tr key={`e-${row.entry.id}`} className="border-t border-border-strong">
                        <td className="px-2 pt-2 pb-1 font-medium">
                          {formatDate(row.entry.entry_date, locale)}
                        </td>
                        <td colSpan={5} className="px-2 pt-2 pb-1 font-medium">
                          <Link
                            to={`/accounting/journal-entries/${row.entry.id}`}
                            className="font-code hover:underline print:no-underline"
                          >
                            {t('book.entryNo', { number: row.entry.number })}
                          </Link>
                          {row.entry.description && (
                            <span className="text-muted-foreground">
                              {' '}
                              · {row.entry.description}
                            </span>
                          )}
                        </td>
                      </tr>
                    ) : (
                      <tr key={`l-${row.entry.id}-${row.line.line_no}`}>
                        <td />
                        <td className="px-2 py-0.5 font-code">{row.line.account_code}</td>
                        <td
                          className={`px-2 py-0.5 ${amountOf(row.line.credit).isZero() ? '' : 'pl-8'}`}
                        >
                          {row.line.account_name}
                        </td>
                        <td className="px-2 py-0.5 text-muted-foreground">
                          {row.line.description}
                        </td>
                        <td className="px-2 py-0.5 text-right tabular-nums">
                          {money(row.line.debit)}
                        </td>
                        <td className="px-2 py-0.5 text-right tabular-nums">
                          {money(row.line.credit)}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
                <tfoot>
                  {totalsRow(t('book.pageTotal'), page.pageTotals, `page-total-${page.number}`)}
                  {totalsRow(
                    page.number === pages.length ? t('book.grandTotal') : t('book.carriedForward'),
                    page.carriedForward,
                    `carried-${page.number}`,
                  )}
                </tfoot>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
