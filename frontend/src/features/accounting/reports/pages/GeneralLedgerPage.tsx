import { useInfiniteQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Loader2, Play } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { FieldShell } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { journalKeys } from '../../journal/api/keys'
import { ExportButtons } from '../../journal/components/ExportButtons'
import { LoadError } from '../../journal/components/LoadError'
import { PresetsMenu } from '../../journal/components/PresetsMenu'
import { AccountCombobox } from '@/features/accounting'
import { useCompany } from '../../journal/hooks/queries'
import { amountOf } from '../../journal/lib/balance'
import { REPORT_PATHS, reportsApi } from '../api'
import { RangeFields } from '../components/RangeFields'
import { hasRange, rangeParams, type ParamRecord } from '../lib/params'
import { useReportParams } from '../lib/useReportParams'
import type { GeneralLedgerLine } from '../types'

const KEYS = ['account_id', 'mode', 'period_id', 'date_from', 'date_to'] as const
const DEFAULTS: ParamRecord = { mode: 'range' }
const ROW_HEIGHT = 34
/** Below this many rows everything is rendered; above it rows go through the virtualizer. */
const VIRTUALIZE_AT = 200
const COLS = 7

/** Signed balance as amount + side ("1.250,00 B"). */
function useBalanceText() {
  const { t } = useTranslation('accountingJournal')
  const locale = useIntlLocale()
  return (signed: string) => {
    const d = amountOf(signed)
    if (d.isZero()) return formatDecimalDisplay('0', { locale })
    const side = d.isNegative() ? t('ledger.creditSide') : t('ledger.debitSide')
    return `${formatDecimalDisplay(d.abs().toFixed(2), { locale })} ${side}`
  }
}

/** Büyük defter: one account, opening balance, movements with running balance, drill-through. */
export function GeneralLedgerPage() {
  const { t } = useTranslation('accountingJournal')
  const locale = useIntlLocale()
  useCompany()
  const { applied, apply, ready } = useReportParams(KEYS, DEFAULTS)
  const [draft, setDraft] = useState<ParamRecord>(applied)
  const params = { account_id: applied.account_id ?? '', ...rangeParams(applied) }
  const valid = (p: ParamRecord) => Boolean(p.account_id) && hasRange(p)
  const enabled = ready && valid(applied)
  const balanceText = useBalanceText()

  const ledger = useInfiniteQuery({
    queryKey: journalKeys.report('general-ledger', params),
    queryFn: ({ pageParam, signal }) => reportsApi.generalLedger(params, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.meta.pagination.current_page < last.meta.pagination.last_page
        ? last.meta.pagination.current_page + 1
        : undefined,
    enabled,
  })
  const rows: GeneralLedgerLine[] = ledger.data?.pages.flatMap((p) => p.data) ?? []
  const meta = ledger.data?.pages[0]?.meta
  const lastMeta = ledger.data?.pages.at(-1)?.meta
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualize = rows.length > VIRTUALIZE_AT
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    enabled: virtualize,
  })
  const items = virtualize ? virtualizer.getVirtualItems() : null
  const lastIndex = items?.at(-1)?.index ?? -1
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = ledger

  // Scrolling near the end of what is loaded fetches the next page.
  useEffect(() => {
    if (virtualize && hasNextPage && !isFetchingNextPage && lastIndex >= rows.length - 20) {
      void fetchNextPage()
    }
  }, [virtualize, hasNextPage, isFetchingNextPage, lastIndex, rows.length, fetchNextPage])

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    if (valid(draft)) apply(draft)
  }

  const money = (v: string) => (amountOf(v).isZero() ? '' : formatDecimalDisplay(v, { locale }))
  // Row indexes count the header (1) and the opening row (2); data rows start at 3.
  const renderRow = (row: GeneralLedgerLine, index: number, style?: CSSProperties) => (
    <tr
      key={row.line_id}
      aria-rowindex={index + 3}
      className="border-t border-border"
      style={style}
    >
      <td className="px-2 py-1 whitespace-nowrap">{formatDate(row.entry_date, locale)}</td>
      <td className="px-2 py-1">
        <Link
          to={`/accounting/journal-entries/${row.entry_id}`}
          className="font-code hover:underline"
        >
          {row.entry_number ?? t('list.unnumbered')}
        </Link>
      </td>
      <td className="px-2 py-1">{t(`entryType.${row.entry_type}`)}</td>
      <td className="max-w-96 truncate px-2 py-1">
        {meta && row.account_id !== meta.account.id && (
          <span className="font-code text-muted-foreground" title={row.account_name}>
            {row.account_code}{' '}
          </span>
        )}
        {row.description}
        {row.party && <span className="text-muted-foreground"> · {row.party.name}</span>}
      </td>
      <td className="px-2 py-1 text-right tabular-nums">{money(row.debit)}</td>
      <td className="px-2 py-1 text-right tabular-nums">{money(row.credit)}</td>
      <td className="px-2 py-1 text-right whitespace-nowrap tabular-nums">
        {balanceText(row.running_balance)}
      </td>
    </tr>
  )

  const padTop = items?.[0]?.start ?? 0
  const padBottom = items ? virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0) : 0

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('ledger.title')}
        description={t('ledger.description')}
        breadcrumbs={[
          { label: t('nav.accounting') },
          { label: t('nav.reports') },
          { label: t('ledger.title') },
        ]}
        actions={
          <>
            <PresetsMenu
              storageKey="accounting.reports.general-ledger"
              allowed={KEYS}
              title={t('presets.params')}
              current={draft}
              onApply={(p) => {
                const next = { ...DEFAULTS, ...p }
                setDraft(next)
                if (valid(next)) apply(next)
              }}
            />
            <ExportButtons
              path={REPORT_PATHS.generalLedger}
              params={params}
              filename="buyuk-defter"
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
        <FieldShell label={t('ledger.account')} className="w-80" required>
          {(control) => (
            <AccountCombobox
              {...control}
              postableOnly={false}
              value={
                draft.account_id === undefined || draft.account_id === '' ? null : draft.account_id
              }
              onChange={(id) => setDraft((d) => ({ ...d, account_id: id ?? '' }))}
            />
          )}
        </FieldShell>
        <RangeFields value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
        <Button type="submit" disabled={!valid(draft)}>
          <Play aria-hidden="true" />
          {t('reports.run')}
        </Button>
      </form>

      {!enabled ? (
        <EmptyState description={t('ledger.choose')} />
      ) : ledger.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : ledger.isError ? (
        <LoadError error={ledger.error} onRetry={() => void ledger.refetch()} />
      ) : (
        <div className="space-y-2">
          {meta && (
            <p className="text-sm">
              <span className="font-code font-semibold">{meta.account.code}</span>{' '}
              {meta.account.name}
              {meta.account.currency_code ? ` · ${meta.account.currency_code}` : ''}
              <span className="text-muted-foreground">
                {' '}
                · {t('ledger.rows', { count: meta.pagination.total })}
              </span>
            </p>
          )}
          <div
            ref={scrollRef}
            className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface"
          >
            <table
              className="w-full text-table"
              aria-label={t('ledger.title')}
              aria-rowcount={meta ? meta.pagination.total + (hasNextPage ? 2 : 3) : undefined}
            >
              <thead className="sticky top-0 z-10 bg-surface-sunken text-xs text-muted-foreground">
                <tr aria-rowindex={1}>
                  <th scope="col" className="h-row px-2 text-left font-medium">
                    {t('fields.entryDate')}
                  </th>
                  <th scope="col" className="px-2 text-left font-medium">
                    {t('fields.number')}
                  </th>
                  <th scope="col" className="px-2 text-left font-medium">
                    {t('fields.entryType')}
                  </th>
                  <th scope="col" className="px-2 text-left font-medium">
                    {t('fields.description')}
                  </th>
                  <th scope="col" className="px-2 text-right font-medium">
                    {t('lines.debit')}
                  </th>
                  <th scope="col" className="px-2 text-right font-medium">
                    {t('lines.credit')}
                  </th>
                  <th scope="col" className="px-2 text-right font-medium">
                    {t('ledger.balance')}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr aria-rowindex={2} className="bg-surface-sunken/60 font-medium">
                  <th scope="row" colSpan={COLS - 1} className="px-2 py-1 text-left">
                    {t('ledger.opening')}
                  </th>
                  <td className="px-2 py-1 text-right tabular-nums" data-testid="opening-balance">
                    {meta ? balanceText(meta.opening_balance) : ''}
                  </td>
                </tr>
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={COLS}
                      className="px-3 py-6 text-center text-sm text-muted-foreground"
                    >
                      {t('ledger.noMovements')}
                    </td>
                  </tr>
                )}
                {items ? (
                  <>
                    {padTop > 0 && (
                      <tr aria-hidden="true">
                        <td colSpan={COLS} style={{ height: padTop, padding: 0 }} />
                      </tr>
                    )}
                    {items.map((v) => {
                      const row = rows[v.index]
                      return row ? renderRow(row, v.index, { height: ROW_HEIGHT }) : null
                    })}
                    {padBottom > 0 && (
                      <tr aria-hidden="true">
                        <td colSpan={COLS} style={{ height: padBottom, padding: 0 }} />
                      </tr>
                    )}
                  </>
                ) : (
                  rows.map((row, i) => renderRow(row, i))
                )}
              </tbody>
              {!hasNextPage && lastMeta && (
                <tfoot className="border-t-2 border-border-strong bg-surface-sunken font-semibold">
                  <tr aria-rowindex={(meta?.pagination.total ?? 0) + 3}>
                    <th scope="row" colSpan={COLS - 3} className="px-2 py-2 text-left">
                      {t('ledger.closing')}
                    </th>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {money(lastMeta.totals.debit)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {money(lastMeta.totals.credit)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums" data-testid="closing-balance">
                      {balanceText(lastMeta.closing_balance)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {hasNextPage && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden="true" />}
              {t('ledger.loadMore', { loaded: rows.length, total: meta?.pagination.total ?? 0 })}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
