import { createColumnHelper } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { DataTable, setFilter, useUrlListQuery } from '@/components/shared/data-table'
import { EmptyState } from '@/components/shared/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate } from '@/lib/datetime'
import { useIntlLocale } from '@/lib/datetime/locale'
import { formatDecimal } from '@/lib/money'
import { Can, usePermission } from '@/lib/permissions'
import { ExchangeRateDialog } from '../components/ExchangeRateDialog'
import { FilterDate } from '../components/FilterDate'
import { LoadError } from '../components/LoadError'
import { NativeSelect } from '../components/NativeSelect'
import { PageShell } from '../components/PageShell'
import { RateStatusBanner } from '../components/RateStatusBanner'
import { useBaseCurrency, useCurrencies, useLatestRates, useRateList } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { REF_PERMISSIONS } from '../permissions'
import type { ExchangeRate } from '../types'

const RATE_DIGITS = 4

function rateText(value: string | null, locale: string) {
  return value === null || value === '' ? '—' : formatDecimal(value, RATE_DIGITS, locale)
}

function SourceBadge({ source }: { source: ExchangeRate['source'] }) {
  const t = useRefT()
  return (
    <Badge tone={source === 'manual' ? 'info' : 'neutral'}>{t(`rates.sources.${source}`)}</Badge>
  )
}

function LatestRates() {
  const t = useRefT()
  const locale = useIntlLocale()
  const latest = useLatestRates()
  const base = useBaseCurrency().data
  const rows = latest.data ?? []

  if (latest.isLoading) return <Skeleton className="h-40 w-full" aria-label={t('states.loading')} />
  if (latest.isError) {
    return <LoadError error={latest.error} onRetry={() => void latest.refetch()} />
  }
  if (rows.length === 0) return <EmptyState title={t('rates.emptyLatest')} compact />

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{t('rates.latestCaption', { base: base ?? 'TRY' })}</caption>
        <thead className="bg-surface-sunken text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('rates.currency')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('rates.date')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('rates.forexBuying')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('rates.forexSelling')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('rates.banknoteBuying')}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t('rates.banknoteSelling')}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t('rates.source')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="px-3 py-2 text-left font-code font-medium">
                {r.currency_code}
              </th>
              <td className="px-3 py-2">{formatDate(r.rate_date, locale)}</td>
              <td className="px-3 py-2 text-right font-code">{rateText(r.forex_buying, locale)}</td>
              <td className="px-3 py-2 text-right font-code">
                {rateText(r.forex_selling, locale)}
              </td>
              <td className="px-3 py-2 text-right font-code">
                {rateText(r.banknote_buying, locale)}
              </td>
              <td className="px-3 py-2 text-right font-code">
                {rateText(r.banknote_selling, locale)}
              </td>
              <td className="px-3 py-2">
                <SourceBadge source={r.source} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const col = createColumnHelper<ExchangeRate>()

function RateHistory() {
  const t = useRefT()
  const locale = useIntlLocale()
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'rate_date', desc: true }] },
    { viewKey: 'reference.exchange-rates' },
  )
  const list = useRateList(query)
  const currencies = useCurrencies()

  const columns = useMemo(
    () => [
      col.accessor('rate_date', {
        header: t('rates.date'),
        enableSorting: true,
        meta: { label: t('rates.date') },
        cell: (c) => formatDate(c.getValue(), locale),
        size: 120,
      }),
      col.accessor('currency_code', {
        header: t('rates.currency'),
        enableSorting: true,
        meta: { label: t('rates.currency') },
        cell: (c) => <span className="font-code">{c.getValue()}</span>,
        size: 100,
      }),
      col.accessor('forex_buying', {
        header: t('rates.forexBuying'),
        meta: { label: t('rates.forexBuying'), align: 'right' },
        cell: (c) => <span className="font-code">{rateText(c.getValue(), locale)}</span>,
        size: 130,
      }),
      col.accessor('forex_selling', {
        header: t('rates.forexSelling'),
        meta: { label: t('rates.forexSelling'), align: 'right' },
        cell: (c) => <span className="font-code">{rateText(c.getValue(), locale)}</span>,
        size: 130,
      }),
      col.accessor('banknote_buying', {
        header: t('rates.banknoteBuying'),
        meta: { label: t('rates.banknoteBuying'), align: 'right' },
        cell: (c) => <span className="font-code">{rateText(c.getValue(), locale)}</span>,
        size: 130,
      }),
      col.accessor('banknote_selling', {
        header: t('rates.banknoteSelling'),
        meta: { label: t('rates.banknoteSelling'), align: 'right' },
        cell: (c) => <span className="font-code">{rateText(c.getValue(), locale)}</span>,
        size: 130,
      }),
      col.accessor('source', {
        header: t('rates.source'),
        meta: {
          label: t('rates.source'),
          filter: {
            key: 'source',
            options: [
              { value: 'tcmb', label: t('rates.sources.tcmb') },
              { value: 'manual', label: t('rates.sources.manual') },
            ],
          },
        },
        cell: (c) => <SourceBadge source={c.getValue()} />,
        size: 110,
      }),
    ],
    [t, locale],
  )

  const rateDate = query.filters.rate_date ?? ''

  return (
    <DataTable<ExchangeRate>
      label={t('rates.history')}
      columns={columns}
      data={list.data?.data ?? []}
      total={list.data?.meta?.pagination?.total ?? list.data?.data.length ?? 0}
      loading={list.isLoading}
      error={list.isError}
      onRetry={() => void list.refetch()}
      query={query}
      onQueryChange={setQuery}
      getRowId={(r) => r.id}
      viewKey="reference.exchange-rates"
      searchable={false}
      toolbar={
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>{t('rates.currency')}</span>
            <NativeSelect
              className="w-40"
              value={query.filters.currency_code ?? ''}
              emptyLabel={t('rates.allCurrencies')}
              options={(currencies.data ?? []).map((c) => ({ value: c.code, label: c.code }))}
              onChange={(e) => setQuery(setFilter(query, 'currency_code', e.target.value))}
            />
          </label>
          {/* The backend filters on one exact rate_date (no date range filter yet). */}
          <div className="space-y-1 text-xs text-muted-foreground">
            <span id="rate-date-label">{t('rates.date')}</span>
            <FilterDate
              labelledBy="rate-date-label"
              className="w-40"
              value={rateDate}
              onCommit={(value) => setQuery(setFilter(query, 'rate_date', value))}
            />
          </div>
        </div>
      }
    />
  )
}

export function ExchangeRatesPage() {
  const t = useRefT()
  const [params, setParams] = useSearchParams()
  const [entryOpen, setEntryOpen] = useState(() => params.get('entry') === '1')
  const canManage = usePermission(REF_PERMISSIONS.exchangeRates.manage)

  return (
    <PageShell
      title={t('rates.title')}
      description={t('rates.subtitle')}
      actions={
        <Can permission={REF_PERMISSIONS.exchangeRates.manage}>
          <Button onClick={() => setEntryOpen(true)}>
            <Plus aria-hidden="true" />
            {t('rates.manualAction')}
          </Button>
        </Can>
      }
    >
      <RateStatusBanner />
      <Tabs defaultValue="latest">
        <TabsList aria-label={t('rates.title')}>
          <TabsTrigger value="latest">{t('rates.latest')}</TabsTrigger>
          <TabsTrigger value="history">{t('rates.history')}</TabsTrigger>
        </TabsList>
        <TabsContent value="latest" className="pt-4">
          <LatestRates />
        </TabsContent>
        <TabsContent value="history" className="pt-4">
          <RateHistory />
        </TabsContent>
      </Tabs>
      {entryOpen && canManage && (
        <ExchangeRateDialog
          onClose={() => {
            setEntryOpen(false)
            if (params.has('entry')) {
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev)
                  next.delete('entry')
                  return next
                },
                { replace: true },
              )
            }
          }}
        />
      )}
    </PageShell>
  )
}
