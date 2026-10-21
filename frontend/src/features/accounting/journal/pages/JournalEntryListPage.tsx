import { createColumnHelper } from '@tanstack/react-table'
import { FilterX, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import {
  DataTable,
  setFilter,
  updateListQuery,
  useUrlListQuery,
  type ListQueryState,
} from '@/components/shared/data-table'
import { DateInput, DecimalInput, FieldShell } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay, INVALID_DECIMAL } from '@/lib/money'
import { Can } from '@/lib/permissions'
import { EntryStatusBadge } from '../components/EntryStatusBadge'
import { ExportButtons } from '../components/ExportButtons'
import { AccountCombobox } from '@/features/accounting'
import { RefPicker } from '../components/pickers'
import { PresetsMenu } from '../components/PresetsMenu'
import { useEntryList, usePartyRecord } from '../hooks/queries'
import { ENTRY_STATUSES, ENTRY_TYPES, type JournalEntrySummary } from '../types'

const VIEW_KEY = 'accounting.journal-entries'
const BASE = '/accounting/journal-entries'
const LIST_FILTERS = [
  'date_from',
  'date_to',
  'entry_type',
  'status',
  'account_id',
  'party_id',
  'amount_min',
  'amount_max',
] as const
const PRESET_KEYS = ['q', ...LIST_FILTERS] as const

/** Amount field that applies its value when the user leaves it (not on every keystroke). */
function AmountFilter({
  label,
  value,
  onCommit,
}: {
  label: string
  value: string
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(value)
  }
  return (
    <FieldShell label={label} className="w-36">
      {(control) => (
        <DecimalInput
          {...control}
          scale={2}
          value={draft}
          className="h-control-sm"
          onChange={setDraft}
          onBlur={() => {
            if (draft !== INVALID_DECIMAL && draft !== value) onCommit(draft)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft !== INVALID_DECIMAL) onCommit(draft)
          }}
        />
      )}
    </FieldShell>
  )
}

export function JournalEntryListPage() {
  const { t } = useTranslation('accountingJournal')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'entry_date', desc: true }] },
    { viewKey: VIEW_KEY },
  )
  const list = useEntryList(query)
  const f = (key: string) => query.filters[key] ?? ''
  const party = usePartyRecord(f('party_id'))
  const change = (key: string, value: string) => setQuery(setFilter(query, key, value))

  const applyPreset = (params: Record<string, string>) => {
    let next: ListQueryState = updateListQuery(query, { q: params.q ?? '', filters: {} })
    for (const key of LIST_FILTERS) if (params[key]) next = setFilter(next, key, params[key])
    setQuery(next)
  }

  const money = (v: string) => formatDecimalDisplay(v, { locale })
  const columns = useMemo(() => {
    const col = createColumnHelper<JournalEntrySummary>()
    return [
      col.accessor('number', {
        header: t('fields.number'),
        enableSorting: true,
        meta: { label: t('fields.number') },
        size: 140,
        cell: (c) => (
          <Link to={`${BASE}/${c.row.original.id}`} className="font-code hover:underline">
            {c.getValue() ?? t('list.unnumbered')}
          </Link>
        ),
      }),
      col.accessor('entry_date', {
        header: t('fields.entryDate'),
        enableSorting: true,
        meta: { label: t('fields.entryDate') },
        size: 110,
        cell: (c) => formatDate(c.getValue(), locale),
      }),
      col.accessor('entry_type', {
        header: t('fields.entryType'),
        meta: {
          label: t('fields.entryType'),
          filter: {
            key: 'entry_type',
            options: ENTRY_TYPES.map((v) => ({ value: v, label: t(`entryType.${v}`) })),
          },
        },
        size: 130,
        cell: (c) => t(`entryType.${c.getValue()}`),
      }),
      col.accessor('description', {
        header: t('fields.description'),
        meta: { label: t('fields.description') },
        size: 320,
        cell: (c) => c.getValue() ?? '',
      }),
      col.accessor('total_debit', {
        header: t('fields.totalDebit'),
        enableSorting: true,
        meta: { label: t('fields.totalDebit'), align: 'right' },
        size: 140,
        cell: (c) => <span className="tabular-nums">{money(c.getValue())}</span>,
      }),
      col.accessor('total_credit', {
        header: t('fields.totalCredit'),
        meta: { label: t('fields.totalCredit'), align: 'right' },
        size: 140,
        cell: (c) => <span className="tabular-nums">{money(c.getValue())}</span>,
      }),
      col.accessor('status', {
        header: t('fields.status'),
        meta: {
          label: t('fields.status'),
          filter: {
            key: 'status',
            options: ENTRY_STATUSES.map((v) => ({ value: v, label: t(`status.${v}`) })),
          },
        },
        size: 110,
        cell: (c) => <EntryStatusBadge status={c.getValue()} />,
      }),
      col.accessor('source_type', {
        header: t('fields.source'),
        meta: { label: t('fields.source') },
        size: 120,
        cell: (c) => c.getValue() ?? t('view.manual'),
      }),
    ]
    // money/locale derive from the same locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, locale])

  const filtered = LIST_FILTERS.some((k) => f(k) !== '') || query.q !== ''
  const exportParams = Object.fromEntries(
    Object.entries({
      q: query.q,
      ...Object.fromEntries(LIST_FILTERS.map((k) => [`filter[${k}]`, f(k)])),
    }).filter(([, v]) => v !== ''),
  )

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        breadcrumbs={[{ label: t('nav.accounting') }, { label: t('list.title') }]}
        actions={
          <>
            <ExportButtons
              path="/journal-entries"
              params={exportParams}
              filename="yevmiye-fisleri"
            />
            <Can permission="accounting.entries.create">
              <Button asChild>
                <Link to={`${BASE}/new`}>
                  <Plus aria-hidden="true" />
                  {t('list.new')}
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <section
        aria-label={t('list.filters')}
        className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
      >
        <FieldShell label={t('filters.dateFrom')} className="w-40">
          {(control) => (
            <DateInput
              {...control}
              value={f('date_from')}
              max={f('date_to') || undefined}
              onChange={(v) => change('date_from', v)}
            />
          )}
        </FieldShell>
        <FieldShell label={t('filters.dateTo')} className="w-40">
          {(control) => (
            <DateInput
              {...control}
              value={f('date_to')}
              min={f('date_from') || undefined}
              onChange={(v) => change('date_to', v)}
            />
          )}
        </FieldShell>
        <FieldShell label={t('filters.account')} className="w-64">
          {(control) => (
            <AccountCombobox
              {...control}
              value={f('account_id') || null}
              onChange={(id) => change('account_id', id ?? '')}
            />
          )}
        </FieldShell>
        <FieldShell label={t('filters.party')} className="w-56">
          {(control) => (
            <RefPicker
              {...control}
              resource="parties"
              clearable
              value={f('party_id')}
              record={party.data ?? null}
              onChange={(id) => change('party_id', id)}
            />
          )}
        </FieldShell>
        <AmountFilter
          label={t('filters.amountMin')}
          value={f('amount_min')}
          onCommit={(v) => change('amount_min', v)}
        />
        <AmountFilter
          label={t('filters.amountMax')}
          value={f('amount_max')}
          onCommit={(v) => change('amount_max', v)}
        />
        <div className="ml-auto flex items-center gap-2">
          {filtered && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setQuery(updateListQuery(query, { q: '', filters: {} }))}
            >
              <FilterX aria-hidden="true" />
              {t('filters.clear')}
            </Button>
          )}
          <PresetsMenu
            storageKey={VIEW_KEY}
            allowed={PRESET_KEYS}
            title={t('presets.views')}
            current={{ q: query.q, ...query.filters }}
            onApply={applyPreset}
          />
        </div>
      </section>
      <DataTable<JournalEntrySummary>
        label={t('list.title')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta.pagination.total ?? 0}
        loading={list.isPending}
        error={list.isError}
        onRetry={() => void list.refetch()}
        query={query}
        onQueryChange={setQuery}
        getRowId={(r) => r.id}
        viewKey={VIEW_KEY}
        enableColumnResizing
        onRowActivate={(r) => void navigate(`${BASE}/${r.id}`)}
      />
    </div>
  )
}
