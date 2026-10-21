import { createColumnHelper } from '@tanstack/react-table'
import { FolderTree, ListTree, Plus, Rows3, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  DataTable,
  updateListQuery,
  useUrlListQuery,
  type ListQueryState,
} from '@/components/shared/data-table'
import { EmptyState } from '@/components/shared/EmptyState'
import { FieldShell } from '@/components/shared/form'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Can, usePermission } from '@/lib/permissions'
import { AccountingShell, AccountTypeBadge, LoadError, NativeSelect } from '../../shared/components'
import { useAccT } from '../../shared/i18n'
import { ACC_PERMISSIONS } from '../../shared/permissions'
import { useAccount, useAccountList, useAccountTree } from '../../shared/queries'
import { SavedViewsMenu } from '../../shared/SavedViewsMenu'
import { ACCOUNT_TYPES, type Account, type AccountType } from '../../shared/types'
import { AccountDetailPanel } from '../components/AccountDetailPanel'
import { AccountDialog } from '../components/AccountDialog'
import { AccountTree } from '../components/AccountTree'
import { ImportWizard } from '../components/ImportWizard'
import {
  ancestors,
  branchIds,
  buildTree,
  isFiltering,
  normalizeTree,
  visibleRows,
} from '../lib/tree'

const VIEW_KEY = 'accounting.accounts'
type Mode = 'tree' | 'flat'
type Editor = { account: Account | null; parent: Account | null } | null

const FILTER_KEYS = ['type', 'is_postable', 'is_active'] as const

export function ChartOfAccountsPage() {
  const t = useAccT()
  const canManage = usePermission(ACC_PERMISSIONS.accounts.manage)
  const [params, setParams] = useSearchParams()
  const mode: Mode = params.get('view') === 'flat' ? 'flat' : 'tree'
  const selectedId = params.get('account')
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'code', desc: false }], perPage: 50 },
    { viewKey: VIEW_KEY },
  )
  const tree = useAccountTree()
  const list = useAccountList(query, mode === 'flat')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [editor, setEditor] = useState<Editor>(null)
  const [importing, setImporting] = useState(() => params.get('import') === '1')

  const accounts = useMemo(() => normalizeTree(tree.data ?? []), [tree.data])
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const roots = useMemo(() => buildTree(accounts), [accounts])
  const filter = {
    q: query.q,
    type: (query.filters.type ?? '') as AccountType | '',
    postable: query.filters.is_postable ?? '',
    active: query.filters.is_active ?? '',
  }
  const rows = useMemo(
    () => visibleRows(roots, expanded, filter),
    // filter is rebuilt from query each render; its fields are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roots, expanded, filter.q, filter.type, filter.postable, filter.active],
  )

  const fetched = useAccount(selectedId && !byId.has(selectedId) ? selectedId : null)
  const selected = selectedId ? (byId.get(selectedId) ?? fetched.data ?? null) : null

  const setParam = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value === null) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )

  const setFilter = (key: string, value: string) => {
    const filters = Object.fromEntries(Object.entries(query.filters).filter(([k]) => k !== key))
    if (value) filters[key] = value
    setQuery(updateListQuery(query, { filters }))
  }

  const toggle = (id: string, open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })

  const select = (a: Account) => setParam('account', a.id)

  const currentView: Record<string, string> = { view: mode, q: query.q }
  for (const k of FILTER_KEYS) if (query.filters[k]) currentView[k] = query.filters[k]
  const applyView = (values: Record<string, string>) => {
    const filters: Record<string, string> = {}
    for (const k of FILTER_KEYS) if (values[k]) filters[k] = values[k]
    const next: ListQueryState = updateListQuery(query, { q: values.q ?? '', filters })
    setQuery(next)
    setParam('view', values.view === 'flat' ? 'flat' : null)
  }

  const typeOptions = ACCOUNT_TYPES.map((v) => ({ value: v, label: t(`accounts.types.${v}`) }))
  const yesNo = (yes: string, no: string) => [
    { value: 'true', label: yes },
    { value: 'false', label: no },
  ]

  const columns = useMemo(() => {
    const col = createColumnHelper<Account>()
    return [
      col.accessor('code', {
        header: t('accounts.fields.code'),
        enableSorting: true,
        meta: { label: t('accounts.fields.code') },
        cell: (c) => <span className="font-code">{c.getValue()}</span>,
        size: 140,
      }),
      col.accessor('name', {
        header: t('accounts.fields.name'),
        enableSorting: true,
        meta: { label: t('accounts.fields.name') },
        size: 320,
      }),
      col.accessor('type', {
        header: t('accounts.fields.type'),
        meta: { label: t('accounts.fields.type'), filter: { options: typeOptions } },
        cell: (c) => <AccountTypeBadge type={c.getValue()} />,
        size: 130,
      }),
      col.accessor('normal_balance', {
        header: t('accounts.fields.normalBalance'),
        meta: { label: t('accounts.fields.normalBalance') },
        cell: (c) => t(`accounts.normal.${c.getValue()}`),
        size: 110,
      }),
      col.accessor('is_postable', {
        header: t('accounts.fields.isPostable'),
        meta: {
          label: t('accounts.fields.isPostable'),
          filter: { options: yesNo(t('accounts.postable'), t('accounts.header')) },
        },
        cell: (c) =>
          c.getValue() ? (
            <Badge tone="success">{t('accounts.postable')}</Badge>
          ) : (
            <Badge>{t('accounts.header')}</Badge>
          ),
        size: 130,
      }),
      col.accessor('currency_code', {
        header: t('accounts.fields.currency'),
        meta: { label: t('accounts.fields.currency') },
        cell: (c) => <span className="font-code">{c.getValue() ?? '—'}</span>,
        size: 90,
      }),
      col.accessor('is_active', {
        header: t('accounts.fields.status'),
        meta: {
          label: t('accounts.fields.status'),
          filter: { options: yesNo(t('accounts.active'), t('accounts.inactive')) },
        },
        cell: (c) => <StatusBadge status={c.getValue() ? 'active' : 'inactive'} />,
        size: 110,
      }),
    ]
    // Columns only depend on translations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  const treeToolbar = (
    <div className="mb-3 flex flex-wrap items-end gap-3">
      <FieldShell label={t('accounts.search')} className="min-w-56 flex-1">
        {(control) => (
          <Input
            {...control}
            type="search"
            value={query.q}
            placeholder={t('accounts.searchPlaceholder')}
            onChange={(e) => setQuery(updateListQuery(query, { q: e.target.value }))}
          />
        )}
      </FieldShell>
      <FieldShell label={t('accounts.fields.type')} className="w-40">
        {(control) => (
          <NativeSelect
            {...control}
            options={typeOptions}
            emptyLabel={t('common.all')}
            value={filter.type}
            onChange={(e) => setFilter('type', e.target.value)}
          />
        )}
      </FieldShell>
      <FieldShell label={t('accounts.fields.isPostable')} className="w-40">
        {(control) => (
          <NativeSelect
            {...control}
            options={yesNo(t('accounts.postable'), t('accounts.header'))}
            emptyLabel={t('common.all')}
            value={filter.postable}
            onChange={(e) => setFilter('is_postable', e.target.value)}
          />
        )}
      </FieldShell>
      <FieldShell label={t('accounts.fields.status')} className="w-36">
        {(control) => (
          <NativeSelect
            {...control}
            options={yesNo(t('accounts.active'), t('accounts.inactive'))}
            emptyLabel={t('common.all')}
            value={filter.active}
            onChange={(e) => setFilter('is_active', e.target.value)}
          />
        )}
      </FieldShell>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={isFiltering(filter)}
          onClick={() => setExpanded(new Set(branchIds(roots)))}
        >
          {t('accounts.tree.expandAll')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={isFiltering(filter)}
          onClick={() => setExpanded(new Set())}
        >
          {t('accounts.tree.collapseAll')}
        </Button>
      </div>
    </div>
  )

  const content =
    mode === 'tree' ? (
      <>
        {treeToolbar}
        {tree.isLoading && <Skeleton className="h-64 w-full" aria-label={t('common.loading')} />}
        {tree.isError && <LoadError error={tree.error} onRetry={() => void tree.refetch()} />}
        {tree.data && accounts.length === 0 && (
          <EmptyState
            icon={<FolderTree className="size-10 text-muted-foreground" aria-hidden="true" />}
            title={t('accounts.empty')}
            description={t('accounts.emptyBody')}
          />
        )}
        {accounts.length > 0 && rows.length === 0 && (
          <p role="status" className="py-6 text-center text-sm text-muted-foreground">
            {t('accounts.noMatch')}
          </p>
        )}
        {rows.length > 0 && (
          <>
            <p role="status" className="sr-only">
              {t('accounts.visibleCount', { count: rows.length })}
            </p>
            <AccountTree
              rows={rows}
              label={t('accounts.title')}
              selectedId={selectedId}
              onSelect={select}
              onToggle={toggle}
              onEdit={canManage ? (a) => setEditor({ account: a, parent: null }) : undefined}
              onAddChild={canManage ? (a) => setEditor({ account: null, parent: a }) : undefined}
            />
          </>
        )}
      </>
    ) : (
      <DataTable<Account>
        label={t('accounts.title')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta?.pagination?.total ?? 0}
        loading={list.isPending}
        error={list.isError}
        onRetry={() => void list.refetch()}
        query={query}
        onQueryChange={setQuery}
        getRowId={(r) => r.id}
        viewKey={VIEW_KEY}
        enableColumnResizing
        onRowActivate={select}
      />
    )

  return (
    <AccountingShell
      wide
      title={t('accounts.title')}
      description={t('accounts.subtitle')}
      actions={
        <>
          <div
            role="group"
            aria-label={t('accounts.viewMode')}
            className="flex rounded-md border border-border p-0.5"
          >
            <Button
              size="sm"
              variant={mode === 'tree' ? 'secondary' : 'ghost'}
              aria-pressed={mode === 'tree'}
              onClick={() => setParam('view', null)}
            >
              <ListTree aria-hidden="true" />
              {t('accounts.treeView')}
            </Button>
            <Button
              size="sm"
              variant={mode === 'flat' ? 'secondary' : 'ghost'}
              aria-pressed={mode === 'flat'}
              onClick={() => setParam('view', 'flat')}
            >
              <Rows3 aria-hidden="true" />
              {t('accounts.flatView')}
            </Button>
          </div>
          <SavedViewsMenu storageKey={VIEW_KEY} current={currentView} onApply={applyView} />
          <Can permission={ACC_PERMISSIONS.accounts.manage}>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <Upload aria-hidden="true" />
              {t('accounts.importAction')}
            </Button>
            <Button
              onClick={() =>
                setEditor({ account: null, parent: selected?.is_active ? selected : null })
              }
            >
              <Plus aria-hidden="true" />
              {t('accounts.new')}
            </Button>
          </Can>
        </>
      }
    >
      <div className={selected ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]' : undefined}>
        <div className="min-w-0">{content}</div>
        {selected && (
          <AccountDetailPanel
            key={selected.id}
            account={selected}
            path={ancestors(byId, selected)}
            canManage={canManage}
            onEdit={(a) => setEditor({ account: a, parent: null })}
            onAddChild={(a) => setEditor({ account: null, parent: a })}
            onClose={() => setParam('account', null)}
            onDeleted={() => setParam('account', null)}
          />
        )}
      </div>
      {editor && (
        <AccountDialog
          account={editor.account}
          parent={editor.parent}
          accounts={accounts}
          onClose={() => setEditor(null)}
          onSaved={(saved) => {
            if (saved.parent_id) toggle(saved.parent_id, true)
            setParam('account', saved.id)
          }}
        />
      )}
      {importing && canManage && (
        <ImportWizard
          onClose={() => {
            setImporting(false)
            setParam('import', null)
          }}
        />
      )}
    </AccountingShell>
  )
}
