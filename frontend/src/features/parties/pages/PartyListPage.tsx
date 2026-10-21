import { createColumnHelper } from '@tanstack/react-table'
import { Download, Loader2, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  DataTable,
  setFilter,
  toListParams,
  updateListQuery,
  useUrlListQuery,
  type ListQueryState,
} from '@/components/shared/data-table'
import { EmptyState } from '@/components/shared/EmptyState'
import { Combobox } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIntlLocale } from '@/lib/datetime'
import { Can, usePermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { isApiError, platform } from '@/platform'
import { partiesApi } from '../api/parties'
import { PartyStatusBadge, RoleBadges } from '../components/RoleBadges'
import { useBulkSetActive, usePartyList } from '../hooks/useParties'
import { saveBlob } from '../lib/download'
import { countryOptions } from '../lib/options'
import { PARTY_ROLES, type Party } from '../types'

const PARTY_VIEW_KEY = 'parties.list'
const DEFAULTS: Partial<ListQueryState> = { sort: [{ id: 'name', desc: false }] }

type Preset = 'all' | 'customers' | 'suppliers' | 'inactive'
const PRESETS: Record<Preset, Record<string, string>> = {
  all: {},
  customers: { role: 'customer', is_active: '1' },
  suppliers: { role: 'supplier', is_active: '1' },
  inactive: { is_active: '0' },
}
const PRESET_LABEL = {
  all: 'list.viewAll',
  customers: 'list.viewCustomers',
  suppliers: 'list.viewSuppliers',
  inactive: 'list.viewInactive',
} as const

function activePreset(filters: Record<string, string>): Preset | null {
  const key = JSON.stringify(
    Object.entries(filters)
      .filter(([k]) => k !== 'country')
      .sort(),
  )
  return (
    (Object.keys(PRESETS) as Preset[]).find(
      (p) => JSON.stringify(Object.entries(PRESETS[p]).sort()) === key,
    ) ?? null
  )
}

export function PartyListPage() {
  const { t } = useTranslation('parties')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { query, setQuery } = useUrlListQuery(DEFAULTS, { viewKey: PARTY_VIEW_KEY })
  const list = usePartyList(toListParams(query))
  const canUpdate = usePermission('parties.update')
  const bulk = useBulkSetActive()
  const rootRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const rows = useMemo(() => list.data?.data ?? [], [list.data])
  const total = list.data?.meta?.pagination?.total ?? rows.length

  // Palette "search parties" lands here with ?focus=search.
  const focusSearch = params.get('focus') === 'search'
  useEffect(() => {
    if (!focusSearch) return
    rootRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('focus')
        return next
      },
      { replace: true },
    )
  }, [focusSearch, setParams])

  const columns = useMemo(() => {
    const col = createColumnHelper<Party>()
    return [
      col.accessor('code', {
        header: t('fields.code'),
        enableSorting: true,
        enableHiding: false,
        meta: { label: t('fields.code') },
        cell: (c) => <span className="font-code">{c.getValue()}</span>,
        size: 110,
      }),
      col.accessor('name', {
        header: t('fields.name'),
        enableSorting: true,
        enableHiding: false,
        meta: { label: t('fields.name') },
        cell: (c) => (
          <Link
            to={`/parties/${encodeURIComponent(c.row.original.id)}`}
            className="font-medium hover:underline"
          >
            {c.getValue()}
          </Link>
        ),
        size: 260,
      }),
      col.accessor('roles', {
        header: t('fields.roles'),
        meta: {
          label: t('fields.roles'),
          filter: {
            key: 'role',
            options: PARTY_ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) })),
          },
        },
        cell: (c) => <RoleBadges roles={c.getValue()} />,
        size: 170,
      }),
      col.accessor('type', {
        header: t('fields.type'),
        meta: { label: t('fields.type') },
        cell: (c) => t(`types.${c.getValue()}`),
        size: 120,
      }),
      col.accessor('tax_number', {
        header: t('fields.tax_number'),
        enableSorting: true,
        meta: { label: t('fields.tax_number') },
        cell: (c) => <span className="font-code">{c.getValue() ?? '—'}</span>,
        size: 140,
      }),
      col.accessor('country', {
        header: t('fields.country'),
        enableSorting: true,
        meta: { label: t('fields.country') },
        cell: (c) => <span className="font-code">{c.getValue()}</span>,
        size: 80,
      }),
      col.accessor('is_active', {
        header: t('fields.status'),
        meta: {
          label: t('fields.status'),
          filter: {
            key: 'is_active',
            options: [
              { value: '1', label: t('status.active') },
              { value: '0', label: t('status.inactive') },
            ],
          },
        },
        cell: (c) => <PartyStatusBadge active={c.getValue()} />,
        size: 110,
      }),
    ]
  }, [t])

  const preset = activePreset(query.filters)
  const filtered = query.q !== '' || Object.keys(query.filters).length > 0

  const runBulk = async (ids: string[], active: boolean, clear: () => void) => {
    const known = new Map(rows.map((r) => [r.id, r]))
    const result = await bulk.mutateAsync({ ids, active, known })
    if (result.ok > 0) platform.notify.success(t('list.bulkDone', { count: result.ok }))
    if (result.failed > 0) {
      // Selection stays so the user can retry; parties already in the target state are skipped,
      // so a retry only re-sends the failed ones.
      platform.notify.error(t('list.bulkFailed', { count: result.failed }))
    } else {
      clear()
    }
    return result.failedIds
  }

  /** The list as filtered and sorted on screen (no paging), as a CSV or XLSX file. */
  const exportList = async (format: 'csv' | 'xlsx') => {
    const params = Object.fromEntries(
      Object.entries(toListParams(query)).filter(([k]) => k !== 'page' && k !== 'per_page'),
    )
    setExporting(true)
    try {
      const file = await partiesApi.export(params, format)
      saveBlob(file.blob, file.filename ?? `parties.${format}`)
    } catch (error) {
      platform.notify.error(
        isApiError(error) && error.message ? error.message : t('list.exportFailed'),
      )
    } finally {
      setExporting(false)
    }
  }

  return (
    <div ref={rootRef} className="mx-auto max-w-[1440px]">
      <PageHeader
        title={t('title')}
        description={t('list.description')}
        actions={
          <>
            <Can permission="parties.export">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" disabled={exporting}>
                    {exporting ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Download aria-hidden="true" />
                    )}
                    {t('list.export')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(['csv', 'xlsx'] as const).map((format) => (
                    <DropdownMenuItem key={format} onSelect={() => void exportList(format)}>
                      {t(format === 'csv' ? 'list.exportCsv' : 'list.exportXlsx')}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </Can>
            <Can permission="parties.create">
              <Button asChild>
                <Link to="/parties/new">
                  <Plus aria-hidden="true" />
                  {t('list.new')}
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <div role="group" aria-label={t('list.views')} className="mb-3 flex flex-wrap gap-1">
        {(Object.keys(PRESETS) as Preset[]).map((p) => (
          <Button
            key={p}
            size="sm"
            variant={preset === p ? 'secondary' : 'ghost'}
            aria-pressed={preset === p}
            className={cn(preset === p && 'border-primary')}
            onClick={() => {
              const country = query.filters.country
              setQuery(
                updateListQuery(query, {
                  filters: { ...PRESETS[p], ...(country ? { country } : {}) },
                }),
              )
            }}
          >
            {t(PRESET_LABEL[p])}
          </Button>
        ))}
      </div>
      <DataTable<Party>
        label={t('list.grid')}
        columns={columns}
        data={rows}
        total={total}
        query={query}
        onQueryChange={setQuery}
        getRowId={(r) => r.id}
        loading={list.isFetching}
        error={list.isError}
        onRetry={() => void list.refetch()}
        viewKey={PARTY_VIEW_KEY}
        selectable={canUpdate}
        onRowActivate={(row) => void navigate(`/parties/${encodeURIComponent(row.id)}`)}
        toolbar={
          <div className="w-44">
            <Combobox
              aria-label={t('list.country')}
              placeholder={t('list.country')}
              value={query.filters.country ?? null}
              onChange={(v) => setQuery(setFilter(query, 'country', v))}
              options={countryOptions(locale)}
              clearable
              className="h-control-sm text-xs"
            />
          </div>
        }
        bulkActions={({ selectedIds, clear }) => (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulk.isPending}
              onClick={() => void runBulk(selectedIds, true, clear)}
            >
              {t('list.activate')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulk.isPending}
              onClick={() => void runBulk(selectedIds, false, clear)}
            >
              {t('list.deactivate')}
            </Button>
          </>
        )}
        emptyState={
          filtered ? (
            <EmptyState
              compact
              title={t('list.emptyFilteredTitle')}
              description={t('list.emptyFilteredBody')}
            />
          ) : (
            <EmptyState
              title={t('list.emptyTitle')}
              description={t('list.emptyBody')}
              action={
                <Can permission="parties.create">
                  <Button asChild size="sm">
                    <Link to="/parties/new">{t('list.new')}</Link>
                  </Button>
                </Can>
              }
            />
          )
        }
      />
    </div>
  )
}
