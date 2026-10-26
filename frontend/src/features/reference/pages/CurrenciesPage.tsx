import { createColumnHelper } from '@tanstack/react-table'
import { useMemo } from 'react'
import { DataTable, useUrlListQuery } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { PageShell } from '../components/PageShell'
import { useBaseCurrency, useCurrencyList, useSetCurrencyActive } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { REF_PERMISSIONS } from '../permissions'
import type { Currency } from '../types'

const col = createColumnHelper<Currency>()

export function CurrenciesPage() {
  const t = useRefT()
  const canManage = usePermission(REF_PERMISSIONS.currencies.update)
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'code', desc: false }] },
    { viewKey: 'reference.currencies' },
  )
  const list = useCurrencyList(query)
  const base = useBaseCurrency().data ?? null
  const setActive = useSetCurrencyActive()

  const toggle = (currency: Currency, isActive: boolean) =>
    setActive.mutate(
      { currency, isActive },
      {
        onError: (error) => platform.notify.error(error.message),
      },
    )

  const columns = useMemo(
    () => [
      col.accessor('code', {
        header: t('fields.code'),
        enableSorting: true,
        meta: { label: t('fields.code') },
        cell: (c) => (
          <span className="flex items-center gap-2">
            <span className="font-code">{c.getValue()}</span>
            {c.getValue() === base && <Badge tone="primary">{t('currencies.base')}</Badge>}
          </span>
        ),
        size: 140,
      }),
      col.accessor('name', {
        header: t('fields.name'),
        enableSorting: true,
        meta: { label: t('fields.name') },
        size: 260,
      }),
      col.accessor('symbol', {
        header: t('currencies.symbol'),
        meta: { label: t('currencies.symbol') },
        size: 100,
      }),
      col.accessor('decimals', {
        header: t('currencies.decimals'),
        meta: { label: t('currencies.decimals'), align: 'right' },
        size: 110,
      }),
      // No filter: the backend's filter[is_active] is the global flag, not the company activation.
      col.accessor('company_is_active', {
        header: t('currencies.activeForCompany'),
        meta: { label: t('currencies.activeForCompany') },
        cell: (c) => {
          const currency = c.row.original
          return canManage ? (
            <label className="inline-flex items-center gap-2">
              <Checkbox
                checked={currency.company_is_active}
                // The base currency must stay active.
                disabled={setActive.isPending || currency.code === base}
                aria-label={t('currencies.toggle', { code: currency.code })}
                onChange={(e) => toggle(currency, e.target.checked)}
              />
              <span className="text-xs text-muted-foreground">
                {currency.company_is_active ? t('fields.active') : t('fields.inactive')}
              </span>
            </label>
          ) : (
            <StatusBadge status={currency.company_is_active ? 'active' : 'inactive'} />
          )
        },
        size: 180,
      }),
    ],
    // toggle closes over the mutation; the column set only depends on these inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, base, canManage, setActive.isPending],
  )

  return (
    <PageShell title={t('currencies.title')} description={t('currencies.subtitle')}>
      <DataTable<Currency>
        label={t('currencies.title')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta?.pagination?.total ?? list.data?.data.length ?? 0}
        loading={list.isLoading}
        error={list.isError}
        onRetry={() => void list.refetch()}
        query={query}
        onQueryChange={setQuery}
        getRowId={(c) => c.code}
        viewKey="reference.currencies"
      />
    </PageShell>
  )
}
